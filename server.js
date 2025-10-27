import express from "express";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import { config } from "dotenv";
import { fetch } from "undici";
import path from "node:path";
import { fileURLToPath } from "node:url";

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Security & perf
app.use(helmet({
  contentSecurityPolicy: false // keep simple for this demo (YouTube embeds etc.)
}));
app.use(compression());
app.use(morgan("tiny"));

// Static site
app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  maxAge: "1h",
  setHeaders(res) {
    res.setHeader("Cache-Control", "public, max-age=3600");
  }
}));

// --- Simple proxy to NWS so we can set a proper User-Agent ---
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "you@example.com";
const APP_NAME = process.env.APP_NAME || "Storm Tracker WX";
const UA = `${APP_NAME} (contact: ${CONTACT_EMAIL})`;

// GET /api/forecast?lat=34.54&lon=-84.06
app.get("/api/forecast", async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: "Invalid lat/lon." });
  }

  try {
    // 1) Resolve gridpoint metadata
    const pointsUrl = `https://api.weather.gov/points/${lat},${lon}`;
    const metaResp = await fetch(pointsUrl, {
      headers: {
        "Accept": "application/geo+json",
        "User-Agent": UA
      }
    });

    if (!metaResp.ok) {
      const text = await metaResp.text();
      return res.status(metaResp.status).json({ error: "Failed to fetch gridpoint metadata", details: text });
    }

    const meta = await metaResp.json();
    const forecastUrl = meta?.properties?.forecast;
    const relative = meta?.properties?.relativeLocation?.properties || null;

    if (!forecastUrl) {
      return res.status(502).json({ error: "No forecast URL returned for that location." });
    }

    // 2) Fetch forecast
    const fcResp = await fetch(forecastUrl, {
      headers: {
        "Accept": "application/geo+json",
        "User-Agent": UA
      }
    });

    if (!fcResp.ok) {
      const text = await fcResp.text();
      return res.status(fcResp.status).json({ error: "Failed to fetch forecast", details: text });
    }

    const forecast = await fcResp.json();
    res.json({
      location: relative ? { city: relative.city, state: relative.state } : null,
      forecast
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error", details: String(err?.message || err) });
  }
});

// Fallback to index.html for any unmatched routes (optional)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Storm Tracker WX running on http://localhost:${PORT}`);
});

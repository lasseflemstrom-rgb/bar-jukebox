import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

async function initDb() {
  await sql`CREATE TABLE IF NOT EXISTS recently_played (track_id TEXT PRIMARY KEY, track_name TEXT, played_at BIGINT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`;
  await sql`INSERT INTO settings (key, value) VALUES ('queue_open', 'true') ON CONFLICT (key) DO NOTHING`;
}

// Token-cache
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!refreshToken) throw new Error("Ingen refresh token");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.SPOTIFY_CLIENT_ID,
      client_secret: process.env.SPOTIFY_CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Token misslyckades");
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

export default async function handler(req, res) {
  await initDb();

  if (req.method === "GET") {
    const type = req.query.type;

    if (type === "settings") {
      const rows = await sql`SELECT * FROM settings`;
      const settings = {};
      rows.forEach(r => settings[r.key] = r.value);
      return res.json(settings);
    }

    if (type === "status") {
      const token = await getToken();
      const [playingRes, queueRes, settingsRows] = await Promise.all([
        fetch("https://api.spotify.com/v1/me/player/currently-playing", {
          headers: { Authorization: "Bearer " + token },
        }),
        fetch("https://api.spotify.com/v1/me/player/queue", {
          headers: { Authorization: "Bearer " + token },
        }),
        sql`SELECT * FROM settings`,
      ]);
      const playing = playingRes.status === 204 ? null : await playingRes.json();
      const queueData = await queueRes.json();
      const settings = {};
      settingsRows.forEach(r => settings[r.key] = r.value);
      return res.json({
        playing,
        queue: queueData.queue || [],
        queueOpen: settings.queue_open !== "false",
      });
    }
  }

  if (req.method === "POST") {
    const { action } = req.body;
    const token = await getToken();

    if (action === "play") {
      await fetch("https://api.spotify.com/v1/me/player/play", { method: "PUT", headers: { Authorization: "Bearer " + token } });
      return res.json({ success: true });
    }
    if (action === "pause") {
      await fetch("https://api.spotify.com/v1/me/player/pause", { method: "PUT", headers: { Authorization: "Bearer " + token } });
      return res.json({ success: true });
    }
    if (action === "skip") {
      await fetch("https://api.spotify.com/v1/me/player/next", { method: "POST", headers: { Authorization: "Bearer " + token } });
      return res.json({ success: true });
    }
    if (action === "openQueue") {
      await sql`UPDATE settings SET value = 'true' WHERE key = 'queue_open'`;
      return res.json({ success: true });
    }
    if (action === "closeQueue") {
      await sql`UPDATE settings SET value = 'false' WHERE key = 'queue_open'`;
      return res.json({ success: true });
    }
  }
}
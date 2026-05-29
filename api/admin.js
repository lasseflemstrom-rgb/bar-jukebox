import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

async function initDb() {
  await sql`CREATE TABLE IF NOT EXISTS guest_queue (track_id TEXT PRIMARY KEY, track_name TEXT, artist_name TEXT, duration_ms INTEGER NOT NULL, added_at BIGINT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS recently_played (track_id TEXT PRIMARY KEY, track_name TEXT, played_at BIGINT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`;
  await sql`INSERT INTO settings (key, value) VALUES ('queue_open', 'true') ON CONFLICT (key) DO NOTHING`;
}

async function getToken() {
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
  return data.access_token;
}

export default async function handler(req, res) {
  await initDb();

  if (req.method === "GET") {
    const type = req.query.type;

    if (type === "queue") {
      const rows = await sql`SELECT * FROM guest_queue ORDER BY added_at ASC`;
      return res.json(rows);
    }

    if (type === "settings") {
      const rows = await sql`SELECT * FROM settings`;
      const settings = {};
      rows.forEach(r => settings[r.key] = r.value);
      return res.json(settings);
    }

    if (type === "playing") {
      const token = await getToken();
      const r = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
        headers: { Authorization: "Bearer " + token },
      });
      if (r.status === 204) return res.json(null);
      return res.json(await r.json());
    }
  }

  if (req.method === "POST") {
    const { action, trackId } = req.body;
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
    if (action === "addNextToSpotify") {
      const rows = await sql`SELECT * FROM guest_queue ORDER BY added_at ASC LIMIT 1`;
      if (rows.length === 0) return res.json({ empty: true });
      const next = rows[0];
      await fetch("https://api.spotify.com/v1/me/player/queue?uri=spotify:track:" + next.track_id, {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
      await sql`INSERT INTO recently_played (track_id, track_name, played_at) VALUES (${next.track_id}, ${next.track_name}, ${Date.now()}) ON CONFLICT (track_id) DO UPDATE SET played_at = ${Date.now()}`;
      await sql`DELETE FROM guest_queue WHERE track_id = ${next.track_id}`;
      return res.json({ success: true, track: next });
    }
    if (action === "clearQueue") {
      await sql`DELETE FROM guest_queue`;
      return res.json({ success: true });
    }
    if (action === "removeFromQueue") {
      await sql`DELETE FROM guest_queue WHERE track_id = ${trackId}`;
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
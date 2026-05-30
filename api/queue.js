import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

async function initDb() {
  await sql`CREATE TABLE IF NOT EXISTS recently_played (track_id TEXT PRIMARY KEY, track_name TEXT, played_at BIGINT NOT NULL)`;
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

  if (req.method === "POST") {
    const { uri, trackId, trackName } = req.body;
    try {
      const token = await getToken();
      const spotifyRes = await fetch("https://api.spotify.com/v1/me/player/queue?uri=" + encodeURIComponent(uri), {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
      if (!spotifyRes.ok) {
        const text = await spotifyRes.text();
        return res.status(500).json({ error: "Spotify: " + spotifyRes.status + " " + text });
      }
      // Spara i recently_played direkt
      if (trackId) {
        await sql`
          INSERT INTO recently_played (track_id, track_name, played_at)
          VALUES (${trackId}, ${trackName || ""}, ${Date.now()})
          ON CONFLICT (track_id) DO UPDATE SET played_at = ${Date.now()}
        `;
      }
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "GET") {
    try {
      const token = await getToken();
      const type = req.query.type;

      if (type === "playlist") {
        let all = [];
        let url = "https://api.spotify.com/v1/playlists/" + process.env.SPOTIFY_PLAYLIST_ID + "/items?limit=50";
        while (url) {
          const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
          const data = await r.json();
          all = all.concat(data.items.filter(i => i.item || i.track).map(i => i.item || i.track));
          url = data.next || null;
        }
        all.sort((a, b) => a.name.localeCompare(b.name, "sv"));
        return res.json(all);
      } else if (type === "playing") {
        const r = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
          headers: { Authorization: "Bearer " + token },
        });
        if (r.status === 204) return res.json(null);
        return res.json(await r.json());
      } else if (type === "queue") {
        const r = await fetch("https://api.spotify.com/v1/me/player/queue", {
          headers: { Authorization: "Bearer " + token },
        });
        return res.json(await r.json());
      }
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
}
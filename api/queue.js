import { neon } from "@neondatabase/serverless";

async function getDb() {
  const sql = neon(process.env.DATABASE_URL);
  // Skapa tabellen om den inte finns
  await sql`
    CREATE TABLE IF NOT EXISTS guest_queue (
      track_id TEXT PRIMARY KEY,
      duration_ms INTEGER NOT NULL,
      added_at BIGINT NOT NULL
    )
  `;
  return sql;
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
  if (req.method === "POST") {
    const { uri, trackId, duration_ms } = req.body;
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
      // Spara i databasen
      if (trackId && duration_ms) {
        try {
          const sql = await getDb();
          await sql`
            INSERT INTO guest_queue (track_id, duration_ms, added_at)
            VALUES (${trackId}, ${duration_ms}, ${Date.now()})
            ON CONFLICT (track_id) DO UPDATE SET added_at = ${Date.now()}
          `;
        } catch (dbErr) {
          console.log("DB error:", dbErr.message);
        }
      }
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

  } else if (req.method === "GET") {
    const type = req.query.type;

    if (type === "guestqueue") {
      try {
        const sql = await getDb();
        const now = Date.now();
        // Ta bort utgångna låtar
        await sql`DELETE FROM guest_queue WHERE added_at + duration_ms + 30000 < ${now}`;
        // Hämta kvarvarande
        const rows = await sql`SELECT * FROM guest_queue ORDER BY added_at ASC`;
        return res.json(rows.map(r => ({
          trackId: r.track_id,
          duration_ms: r.duration_ms,
          addedAt: parseInt(r.added_at),
        })));
      } catch (err) {
        console.log("DB error:", err.message);
        return res.json([]);
      }
    }

    try {
      const token = await getToken();

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

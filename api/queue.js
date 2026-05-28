import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS guest_queue (
      track_id TEXT PRIMARY KEY,
      duration_ms INTEGER NOT NULL,
      added_at BIGINT NOT NULL
    )
  `;
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
      if (trackId && duration_ms) {
        await sql`
          INSERT INTO guest_queue (track_id, duration_ms, added_at)
          VALUES (${trackId}, ${duration_ms}, ${Date.now()})
          ON CONFLICT (track_id) DO UPDATE SET added_at = ${Date.now()}
        `;
      }
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

  } else if (req.method === "GET") {
    const type = req.query.type;
    const nowPlayingId = req.query.nowPlayingId;

    if (type === "guestqueue") {
      try {
        // Ta bort låten som spelas just nu om den finns i kön
        if (nowPlayingId) {
          await sql`DELETE FROM guest_queue WHERE track_id = ${nowPlayingId}`;
        }
        // Ta bort låtar som är för gamla (säkerhetsnät, 2 timmar)
        const twoHoursAgo = Date.now() - 7200000;
        await sql`DELETE FROM guest_queue WHERE added_at < ${twoHoursAgo}`;
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
        return res.j
git add .
git commit -m "rensa kö när låt börjar spelas"
git push
cat > api/admin.js << 'ENDOFFILE'
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS guest_queue (
      track_id TEXT PRIMARY KEY,
      track_name TEXT,
      artist_name TEXT,
      duration_ms INTEGER NOT NULL,
      added_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS recently_played (
      track_id TEXT PRIMARY KEY,
      track_name TEXT,
      played_at BIGINT NOT NULL
    )
  `;
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
  const token = await getToken();

  if (req.method === "GET") {
    const type = req.query.type;

    if (type === "queue") {
      // Hämta kön
      const rows = await sql`SELECT * FROM guest_queue ORDER BY added_at ASC`;
      return res.json(rows);
    }

    if (type === "playing") {
      const r = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
        headers: { Authorization: "Bearer " + token },
      });
      if (r.status === 204) return res.json(null);
      return res.json(await r.json());
    }
  }

  if (req.method === "POST") {
    const { action, trackId, progressMs, durationMs } = req.body;

    if (action === "play") {
      await fetch("https://api.spotify.com/v1/me/player/play", {
        method: "PUT",
        headers: { Authorization: "Bearer " + token },
      });
      return res.json({ success: true });
    }

    if (action === "pause") {
      await fetch("https://api.spotify.com/v1/me/player/pause", {
        method: "PUT",
        headers: { Authorization: "Bearer " + token },
      });
      return res.json({ success: true });
    }

    if (action === "skip") {
      await fetch("https://api.spotify.com/v1/me/player/next", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
      return res.json({ success: true });
    }

    if (action === "addNextToSpotify") {
      // Hämta nästa låt i kön och lägg till i Spotify
      const rows = await sql`SELECT * FROM guest_queue ORDER BY added_at ASC LIMIT 1`;
      if (rows.length === 0) return res.json({ empty: true });
      const next = rows[0];

      // Lägg till i Spotify
      await fetch("https://api.spotify.com/v1/me/player/queue?uri=spotify:track:" + next.track_id, {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });

      // Flytta till recently_played
      await sql`
        INSERT INTO recently_played (track_id, track_name, played_at)
        VALUES (${next.track_id}, ${next.track_name}, ${Date.now()})
        ON CONFLICT (track_id) DO UPDATE SET played_at = ${Date.now()}
      `;

      // Ta bort från kön
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
  }
}

import { neon } from "@neondatabase/serverless";
import { getToken } from "./spotify-token.js";

const sql = neon(process.env.DATABASE_URL);

async function initDb() {
  await sql`CREATE TABLE IF NOT EXISTS recently_played (track_id TEXT PRIMARY KEY, track_name TEXT, played_at BIGINT NOT NULL)`;
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

      } else if (type === "recentlyplayed") {
        const rows = await sql`SELECT track_id FROM recently_played ORDER BY played_at DESC LIMIT 8`;
        return res.json(rows.map(r => r.track_id));

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

      } else if (type === "status") {
        const [playingRes, recent, settings] = await Promise.all([
          fetch("https://api.spotify.com/v1/me/player/currently-playing", {
            headers: { Authorization: "Bearer " + token },
          }),
          sql`SELECT track_id FROM recently_played ORDER BY played_at DESC LIMIT 8`,
          sql`SELECT value FROM settings WHERE key = 'queue_open'`.catch(() => []),
        ]);
        const playing = playingRes.status === 204 ? null : await playingRes.json();
        return res.json({
          playing,
          recentlyPlayed: recent.map(r => r.track_id),
          queueOpen: settings[0]?.value !== "false",
        });
      }

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
}
     
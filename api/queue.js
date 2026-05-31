import { neon } from "@neondatabase/serverless";
import { getToken } from "./spotify-token.js";

const sql = neon(process.env.DATABASE_URL);

async function initDb() {
  await sql`CREATE TABLE IF NOT EXISTS recently_played (track_id TEXT PRIMARY KEY, track_name TEXT, played_at BIGINT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS guest_queue (id SERIAL PRIMARY KEY, track_id TEXT NOT NULL, track_name TEXT, artist_name TEXT, duration_ms INTEGER, added_at BIGINT NOT NULL)`;
}

export default async function handler(req, res) {
  await initDb();

  if (req.method === "POST") {
    const { uri, trackId, trackName, artistName, durationMs } = req.body;
    try {
      const token = await getToken();

      // Kolla kölängd
      const count = await sql`SELECT COUNT(*) FROM guest_queue WHERE added_at > ${Date.now() - 60 * 60 * 1000}`;
      if (parseInt(count[0].count) >= 3) {
        return res.status(400).json({ error: "Kön är full" });
      }

      // Lägg till i Spotify
      const spotifyRes = await fetch("https://api.spotify.com/v1/me/player/queue?uri=" + encodeURIComponent(uri), {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
      if (!spotifyRes.ok) {
        const text = await spotifyRes.text();
        return res.status(500).json({ error: "Spotify: " + spotifyRes.status + " " + text });
      }

      // Lägg till i guest_queue
      await sql`INSERT INTO guest_queue (track_id, track_name, artist_name, duration_ms, added_at) VALUES (${trackId}, ${trackName || ""}, ${artistName || ""}, ${durationMs || 0}, ${Date.now()})`;

      // Spara i recently_played
      if (trackId) {
        await sql`INSERT INTO recently_played (track_id, track_name, played_at) VALUES (${trackId}, ${trackName || ""}, ${Date.now()}) ON CONFLICT (track_id) DO UPDATE SET played_at = ${Date.now()}`;
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
        await sql`DELETE FROM recently_played WHERE played_at < ${Date.now() - 90 * 60 * 1000}`;
        const rows = await sql`SELECT track_id FROM recently_played ORDER BY played_at DESC LIMIT 8`;
        return res.json(rows.map(r => r.track_id));

      } else if (type === "guestqueue") {
        await sql`DELETE FROM guest_queue WHERE added_at < ${Date.now() - 60 * 60 * 1000}`;
        await sql`DELETE FROM recently_played WHERE played_at < ${Date.now() - 90 * 60 * 1000}`;
        const rows = await sql`SELECT * FROM guest_queue ORDER BY added_at ASC`;
        return res.json(rows);

      } else if (type === "playing") {
        const r = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
          headers: { Authorization: "Bearer " + token },
        });
        if (r.status === 204) return res.json(null);
        return res.json(await r.json());

      } else if (type === "status") {
        // Rensa gamla poster
        await sql`DELETE FROM guest_queue WHERE added_at < ${Date.now() - 60 * 60 * 1000}`;
        await sql`DELETE FROM recently_played WHERE played_at < ${Date.now() - 90 * 60 * 1000}`;

        const [playingRes, recent, settings] = await Promise.all([
          fetch("https://api.spotify.com/v1/me/player/currently-playing", {
            headers: { Authorization: "Bearer " + token },
          }),
          sql`SELECT track_id FROM recently_played ORDER BY played_at DESC LIMIT 8`,
          sql`SELECT value FROM settings WHERE key = 'queue_open'`.catch(() => []),
        ]);

        const playing = playingRes.status === 204 ? null : await playingRes.json();

        // Ta bort från guest_queue om låten spelas nu
        if (playing?.item) {
          await sql`DELETE FROM guest_queue WHERE track_id = ${playing.item.id}`;
        }

        const updatedQueue = await sql`SELECT * FROM guest_queue ORDER BY added_at ASC`;

        return res.json({
          playing,
          recentlyPlayed: recent.map(r => r.track_id),
          queueOpen: settings[0]?.value !== "false",
          guestQueue: updatedQueue,
          guestQueueCount: updatedQueue.length,
        });
      }

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
}
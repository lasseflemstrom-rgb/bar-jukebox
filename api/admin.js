import { neon } from "@neondatabase/serverless";
import { getToken } from "./spotify-token.js";

const sql = neon(process.env.DATABASE_URL);

async function initDb() {
  await sql`CREATE TABLE IF NOT EXISTS recently_played (track_id TEXT PRIMARY KEY, track_name TEXT, played_at BIGINT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`;
  await sql`INSERT INTO settings (key, value) VALUES ('queue_open', 'true') ON CONFLICT (key) DO NOTHING`;
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
      const [playingRes, queueRes, settingsRows, guestRows] = await Promise.all([
        fetch("https://api.spotify.com/v1/me/player/currently-playing", {
          headers: { Authorization: "Bearer " + token },
        }),
        fetch("https://api.spotify.com/v1/me/player/queue", {
          headers: { Authorization: "Bearer " + token },
        }),
        sql`SELECT * FROM settings`,
        sql`SELECT * FROM guest_queue ORDER BY added_at ASC`,
      ]);
      const playing = playingRes.status === 204 ? null : await playingRes.json();
      const queueData = await queueRes.json();
      const settings = {};
      settingsRows.forEach(r => settings[r.key] = r.value);
      return res.json({
        playing,
        queue: queueData.queue || [],
        queueOpen: settings.queue_open !== "false",
        guestQueue: guestRows,
      });
    }

    if (type === "playlist") {
      const token = await getToken();
      let all = [];
      let url = "https://api.spotify.com/v1/playlists/" + process.env.SPOTIFY_PLAYLIST_ID + "/items?limit=50";
      while (url) {
        const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
        const data = await r.json();
        all = all.concat(data.items.filter(i => i.track || i.item).map(i => i.track || i.item));
        url = data.next || null;
      }
      all.sort((a, b) => a.name.localeCompare(b.name, "sv"));
      return res.json(all);
    }

    if (type === "search") {
      const token = await getToken();
      const q = req.query.q;
      const r = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=10&market=SE`, {
        headers: { Authorization: "Bearer " + token },
      });
      const data = await r.json();
      return res.json(data.tracks?.items || []);
    }

    if (type === "recommendations") {
      const token = await getToken();
      let all = [];
      let url = "https://api.spotify.com/v1/playlists/" + process.env.SPOTIFY_PLAYLIST_ID + "/items?limit=50";
      while (url) {
        const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
        const data = await r.json();
        all = all.concat(data.items.filter(i => i.track || i.item).map(i => i.track || i.item));
        url = data.next || null;
      }
      const shuffled = all.sort(() => Math.random() - 0.5).slice(0, 5);
      const existingIds = new Set(all.map(t => t.id));
      const results = [];
      for (const track of shuffled) {
        const artist = track.artists?.[0]?.name;
        if (!artist) continue;
        const r = await fetch(
          `https://api.spotify.com/v1/search?q=artist:${encodeURIComponent(artist)}&type=track&limit=5&market=SE`,
          { headers: { Authorization: "Bearer " + token } }
        );
        const data = await r.json();
        const tracks = (data.tracks?.items || []).filter(t => !existingIds.has(t.id));
        if (tracks.length > 0) results.push(tracks[0]);
      }
      return res.json(results);
    }
  }

  if (req.method === "POST") {
    const { action, uri } = req.body;
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
    if (action === "addToPlaylist") {
      await fetch(`https://api.spotify.com/v1/playlists/${process.env.SPOTIFY_PLAYLIST_ID}/tracks`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ uris: [uri] }),
      });
      return res.json({ success: true });
    }
    if (action === "removeFromPlaylist") {
      await fetch(`https://api.spotify.com/v1/playlists/${process.env.SPOTIFY_PLAYLIST_ID}/tracks`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ tracks: [{ uri }] }),
      });
      return res.json({ success: true });
    }
  }
}

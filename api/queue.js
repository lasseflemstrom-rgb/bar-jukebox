import { list, put, del } from "@vercel/blob";

async function getToken() {
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!refreshToken) throw new Error("Ingen refresh token - logga in på /api/auth");

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
  if (!data.access_token) throw new Error("Kunde inte förnya token: " + JSON.stringify(data));
  return data.access_token;
}

async function getGuestQueue() {
  try {
    const { blobs } = await list({ prefix: "guestqueue/" });
    const items = await Promise.all(blobs.map(async (b) => {
      const r = await fetch(b.downloadUrl);
      return r.json();
    }));
    // Sortera efter addedAt
    return items.sort((a, b) => a.addedAt - b.addedAt);
  } catch {
    return [];
  }
}

async function cleanExpiredQueue(queue) {
  const now = Date.now();
  for (const item of queue) {
    // Ta bort låtar som borde ha spelats klart
    if (now > item.addedAt + item.duration_ms + 30000) {
      try {
        const { blobs } = await list({ prefix: "guestqueue/" });
        const blob = blobs.find(b => b.pathname === `guestqueue/${item.trackId}.json`);
        if (blob) await del(blob.url);
      } catch {}
    }
  }
}

export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      const { uri, trackId, duration_ms } = req.body;
      const token = await getToken();
      const spotifyRes = await fetch("https://api.spotify.com/v1/me/player/queue?uri=" + encodeURIComponent(uri), {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
      const text = await spotifyRes.text();
      if (!spotifyRes.ok) {
        return res.status(500).json({ error: "Spotify fel: " + spotifyRes.status + " " + text });
      }
      // Spara i Blob
      await put("guestqueue/" + trackId + ".json", JSON.stringify({
        trackId,
        duration_ms,
        addedAt: Date.now(),
      }), { access: "private", allowOverwrite: true });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else if (req.method === "DELETE") {
    // Ta bort en låt från gästkön
    try {
      const { trackId } = req.body;
      const { blobs } = await list({ prefix: "guestqueue/" });
      const blob = blobs.find(b => b.pathname === "guestqueue/" + trackId + ".json");
      if (blob) await del(blob.url);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else if (req.method === "GET") {
    try {
      const token = await getToken();
      const type = req.query.type;

      if (type === "guestqueue") {
        const queue = await getGuestQueue();
        await cleanExpiredQueue(queue);
        const freshQueue = await getGuestQueue();
        return res.json(freshQueue);
      } else if (type === "playlist") {
        let all = [];
        let url = "https://api.spotify.com/v1/playlists/" + process.env.SPOTIFY_PLAYLIST_ID + "/items?limit=50";
        while (url) {
          const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
          const data = await r.json();
          all = all.concat(data.items.filter(function(i) { return i.item || i.track; }).map(function(i) { return i.item || i.track; }));
          url = data.next || null;
        }
        all.sort(function(a, b) { return a.name.localeCompare(b.name, "sv"); });
        res.json(all);
      } else if (type === "playing") {
        const r = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
          headers: { Authorization: "Bearer " + token },
        });
        if (r.status === 204) return res.json(null);
        res.json(await r.json());
      } else if (type === "queue") {
        const r = await fetch("https://api.spotify.com/v1/me/player/queue", {
          headers: { Authorization: "Bearer " + token },
        });
        res.json(await r.json());
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
}

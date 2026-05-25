import { list, head } from "@vercel/blob";
import { put } from "@vercel/blob";

async function getToken() {
  const { blobs } = await list();
  const tokenBlob = blobs.find(function(b) { return b.pathname === "spotify-token.json"; });
  if (!tokenBlob) throw new Error("Token saknas - logga in på /api/auth");
  
  const blobInfo = await head(tokenBlob.url);
  const res = await fetch(blobInfo.downloadUrl);
  const data = await res.json();

  if (Date.now() > data.expires_at) {
    const refreshRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: data.refresh_token,
        client_id: process.env.SPOTIFY_CLIENT_ID,
        client_secret: process.env.SPOTIFY_CLIENT_SECRET,
      }),
    });
    const refreshData = await refreshRes.json();
    const newToken = {
      access_token: refreshData.access_token,
      refresh_token: refreshData.refresh_token || data.refresh_token,
      expires_at: Date.now() + (refreshData.expires_in - 60) * 1000,
    };
    await put("spotify-token.json", JSON.stringify(newToken), { access: "private", allowOverwrite: true });
    return newToken.access_token;
  }
  return data.access_token;
}

export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      const { uri } = req.body;
      const token = await getToken();
      await fetch("https://api.spotify.com/v1/me/player/queue?uri=" + encodeURIComponent(uri), {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else if (req.method === "GET") {
    try {
      const token = await getToken();
      const type = req.query.type;

      if (type === "playlist") {
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

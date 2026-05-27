import { list, put, del } from "@vercel/blob";

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
      // Lägg till i Spotify
      const token = await getToken();
      const spotifyRes = await fetch("https://api.spotify.com/v1/me/player/queue?uri=" + encodeURIComponent(uri), {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
      if (!spotifyRes.ok) {
        const text = await spotifyRes.text();
        return res.status(500).json({ error: "Spotify: " + spotifyRes.status + " " + text });
      }
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

    // Spara i Blob (separat try så Spotify-fel inte påverkar)
    if (trackId && duration_ms) {
      try {
        await put("guestqueue/" + trackId + ".json", JSON.stringify({
          trackId,
          duration_ms,
          addedAt: Date.now(),
        }), { access: "public", allowOverwrite: true });
      } catch (blobErr) {
        console.log("Blob sparning misslyckades:", blobErr.message);
      }
    }

    return res.json({ success: true });

  } else if (req.method === "GET") {
    const type = req.query.type;

    if (type === "guestqueue") {
      try {
        const allBlobs = await list();
        const guestBlobs = allBlobs.blobs.filter(b => b.pathname.startsWith("guestqueue/"));
        const now = Date.now();
        const items = [];
        for (const b of guestBlobs) {
          try {
            const r = await fetch(b.url);
            const item = await r.json();
            if (now < item.addedAt + item.duration_ms + 30000) {
              items.push(item);
            } else {
              await del(b.url);
            }
          } catch {}
        }
        items.sort((a, b) => a.addedAt - b.addedAt);
        return res.json(items);
      } catch (err) {
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

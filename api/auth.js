import { put, get } from "@vercel/blob";

export default async function handler(req, res) {
  if (req.method === "GET") {
    // Steg 1: Redirecta ägaren till Spotify-inloggning
    const params = new URLSearchParams({
      client_id: process.env.SPOTIFY_CLIENT_ID,
      response_type: "code",
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
      scope: "playlist-read-private playlist-read-collaborative user-modify-playback-state user-read-playback-state playlist-modify-public playlist-modify-private",
    });
    return res.redirect(`https://accounts.spotify.com/authorize?${params}`);
  }

  if (req.method === "POST") {
    // Steg 2: Byt ut code mot token och spara i Blob
    const { code } = req.body;
    const res2 = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
        client_id: process.env.SPOTIFY_CLIENT_ID,
        client_secret: process.env.SPOTIFY_CLIENT_SECRET,
      }),
    });
    const data = await res2.json();
    if (!data.access_token) return res.status(400).json({ error: "Auth failed" });

    // Spara token + refresh_token i Blob
    await put("spotify-token.json", JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in - 60) * 1000,
    }), { access: "public", allowOverwrite: true });

    return res.json({ success: true });
  }
}

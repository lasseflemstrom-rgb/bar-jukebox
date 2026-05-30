export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).send("Ingen kod hittades");
  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
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
  const data = await tokenRes.json();
  if (!data.access_token) return res.status(400).send("Auth misslyckades: " + JSON.stringify(data));
  
  const { put, list, del } = await import("@vercel/blob");
  
  // Ta bort gamla token-filer
  const { blobs } = await list({ prefix: "spotify-token" });
  for (const blob of blobs) {
    await del(blob.url);
  }
  
  // Spara ny token
  await put("spotify-token.json", JSON.stringify({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
  }), { access: "public", allowOverwrite: true });
  
  res.send("✅ Inloggad! Stäng fönstret.");
}
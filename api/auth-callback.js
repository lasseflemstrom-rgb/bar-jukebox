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

  res.send(`✅ Inloggad! Din refresh token:<br><br><code style="word-break:break-all">${data.refresh_token}</code><br><br>Kopiera den till Vercel Environment Variables som SPOTIFY_REFRESH_TOKEN.`);
}

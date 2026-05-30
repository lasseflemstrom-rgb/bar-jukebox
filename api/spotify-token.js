import { list, put, getDownloadUrl } from "@vercel/blob";

export async function getToken() {
  const { blobs } = await list({ prefix: "spotify-token" });
  if (!blobs.length) throw new Error("Ingen token – logga in på /api/auth");
  
  const blobRes = await fetch(blobs[0].downloadUrl);
  const tokenData = await blobRes.json();
  
  if (tokenData.access_token && Date.now() < tokenData.expires_at) {
    return tokenData.access_token;
  }
  
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenData.refresh_token,
      client_id: process.env.SPOTIFY_CLIENT_ID,
      client_secret: process.env.SPOTIFY_CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Token-förnyelse misslyckades");
  
  await put("spotify-token.json", JSON.stringify({
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokenData.refresh_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
  }), { access: "private", allowOverwrite: true });
  
  return data.access_token;
}

export default async function handler(req, res) {
  try {
    const token = await getToken();
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
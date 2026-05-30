import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

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
  try {
    // Kolla om det finns låtar i kön
    const rows = await sql`SELECT * FROM guest_queue ORDER BY added_at ASC LIMIT 1`;
    if (remaining > 20000) {
  // Schemalägg nästa anrop om (remaining - 20 sek)
  const delay = Math.max(5, Math.floor((remaining - 20000) / 1000));
  await fetch("https://qstash.upstash.io/v2/publish/https://bar-jukebox.vercel.app/api/cron", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.QSTASH_TOKEN,
      "Content-Type": "application/json",
      "Upstash-Delay": delay + "s",
    },
    body: JSON.stringify({}),
  });
  return res.json({ status: "waiting", remaining, nextCheck: delay });
}

    // Kolla nuvarande uppspelning
    const token = await getToken();
    const playbackRes = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: { Authorization: "Bearer " + token },
    });

    if (playbackRes.status === 204) return res.json({ status: "not_playing" });
    const playback = await playbackRes.json();
    if (!playback?.item) return res.json({ status: "not_playing" });

    const remaining = playback.item.duration_ms - (playback.progress_ms || 0);

    // Trigga om 20 sekunder kvar
    if (remaining > 20000) return res.json({ status: "waiting", remaining });

    const next = rows[0];

    // Lägg till i Spotify
    const spotifyRes = await fetch("https://api.spotify.com/v1/me/player/queue?uri=spotify:track:" + next.track_id, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    });

    if (!spotifyRes.ok) {
      const text = await spotifyRes.text();
      return res.status(500).json({ error: "Spotify: " + text });
    }

    // Flytta till recently_played och ta bort från kön
    await sql`INSERT INTO recently_played (track_id, track_name, played_at) VALUES (${next.track_id}, ${next.track_name}, ${Date.now()}) ON CONFLICT (track_id) DO UPDATE SET played_at = ${Date.now()}`;
    await sql`DELETE FROM guest_queue WHERE track_id = ${next.track_id}`;

    return res.json({ status: "queued", track: next.track_name });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

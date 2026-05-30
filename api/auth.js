export default async function handler(req, res) {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
    scope: "playlist-read-private playlist-read-collaborative user-modify-playback-state user-read-playback-state playlist-modify-public playlist-modify-private",
    show_dialog: "true",
  });
  return res.redirect(`https://accounts.spotify.com/authorize?${params}`);
}

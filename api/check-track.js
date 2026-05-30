import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { trackId } = req.body;
  try {
    await sql`CREATE TABLE IF NOT EXISTS recently_played (track_id TEXT PRIMARY KEY, track_name TEXT, played_at BIGINT NOT NULL)`;
    const recent = await sql`
      SELECT track_id FROM recently_played
      ORDER BY played_at DESC
      LIMIT 8
    `;
    if (recent.some(r => r.track_id === trackId)) {
      return res.json({ blocked: true, reason: "recentlyPlayed" });
    }
    return res.json({ blocked: false });
  } catch {
    return res.json({ blocked: false });
  }
}
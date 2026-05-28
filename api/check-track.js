import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { trackId } = req.body;
  try {
    await sql`CREATE TABLE IF NOT EXISTS guest_queue (track_id TEXT PRIMARY KEY, track_name TEXT, artist_name TEXT, duration_ms INTEGER NOT NULL, added_at BIGINT NOT NULL)`;
    await sql`CREATE TABLE IF NOT EXISTS recently_played (track_id TEXT PRIMARY KEY, track_name TEXT, played_at BIGINT NOT NULL)`;
    const inQueue = await sql`SELECT track_id FROM guest_queue WHERE track_id = ${trackId}`;
    if (inQueue.length > 0) return res.json({ blocked: true, reason: "inQueue" });
    const fortyFiveMinAgo = Date.now() - 45 * 60 * 1000;
    const recent = await sql`SELECT track_id FROM recently_played WHERE track_id = ${trackId} AND played_at > ${fortyFiveMinAgo}`;
    if (recent.length > 0) return res.json({ blocked: true, reason: "recentlyPlayed" });
    return res.json({ blocked: false });
  } catch {
    return res.json({ blocked: false });
  }
}

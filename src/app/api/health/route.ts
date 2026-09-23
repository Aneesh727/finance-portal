import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** liveness/readiness probe: checks the database is reachable. No sensitive data. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: 'ok', db: 'up', time: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ status: 'degraded', db: 'down' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

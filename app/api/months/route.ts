import { NextResponse } from 'next/server';
import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function GET() {
  try {
    const { env } = getCloudflareContext();
    const db = env.baywheels;
    const kv = env.baywheel_kv;
    const months = new Set<string>();
    let readSource = false;

    if (db) {
      try {
        const result = await db
          .prepare(`
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name GLOB 'rides_[0-9][0-9][0-9][0-9][0-9][0-9]'
          `)
          .all<{ name: string }>();
        for (const row of result.results || []) {
          const match = row.name.match(/^rides_(\d{4})(\d{2})$/);
          if (match) months.add(`${match[1]}-${match[2]}`);
        }
        readSource = true;
      } catch (error) {
        console.warn('Could not read D1 month tables:', error);
      }
    }

    if (kv) {
      try {
        let cursor: string | undefined;
        do {
          const page = await kv.list({
            prefix: 'month-index:v1:',
            limit: 1000,
            ...(cursor ? { cursor } : {}),
          });
          for (const key of page.keys) {
            const match = key.name.match(/^month-index:v1:(\d{4})-(\d{2})$/);
            if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12) {
              months.add(`${match[1]}-${match[2]}`);
            }
          }
          readSource = true;
          cursor = page.list_complete ? undefined : page.cursor;
        } while (cursor);
      } catch (error) {
        console.warn('Could not read cached month index:', error);
      }
    }

    if (!readSource) {
      return NextResponse.json({ error: 'No month data source is available' }, { status: 500 });
    }

    return NextResponse.json(
      { months: [...months].sort((a, b) => a.localeCompare(b)) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error fetching available months:', error);
    return NextResponse.json(
      { error: 'Failed to fetch available months' },
      { status: 500 }
    );
  }
}

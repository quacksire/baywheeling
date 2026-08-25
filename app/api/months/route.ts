import { NextResponse } from 'next/server';
import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function GET() {
  try {
    const { env } = getCloudflareContext();
    const db = env.baywheels;

    if (!db) {
      return NextResponse.json(
        { error: 'Database binding not found' },
        { status: 500 }
      );
    }

    const result = await db
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name GLOB 'rides_[0-9][0-9][0-9][0-9][0-9][0-9]'
        ORDER BY name DESC
      `)
      .all<{ name: string }>();

    const months = (result.results || [])
      .map((row) => row.name.match(/^rides_(\d{4})(\d{2})$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => `${match[1]}-${match[2]}`);

    return NextResponse.json(
      { months },
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

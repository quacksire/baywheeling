import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const stationId = searchParams.get('station_id');
  const yearMonth = searchParams.get('year_month'); // YYYY-MM format (required)

  if (!stationId) {
    return NextResponse.json(
      { error: 'station_id is required' },
      { status: 400 }
    );
  }

  if (!yearMonth) {
    return NextResponse.json(
      { error: 'year_month is required in YYYY-MM format' },
      { status: 400 }
    );
  }

  try {
    const { env } = getCloudflareContext();
    const db = env.baywheels;
    const kv = env.baywheel_kv;

    if (!db) {
      return NextResponse.json(
        { error: 'Database binding not found' },
        { status: 500 }
      );
    }
    const tableName = `rides_${yearMonth.replace('-', '')}`;

     const query = `
       SELECT ride_id, rideable_type, started_at, end_station_name, start_station_id, end_station_id, route_polyline
       FROM ${tableName}
       WHERE start_station_id = ?
       ORDER BY started_at DESC;
     `;

     const result = await db.prepare(query).bind(stationId).all();

    // If KV is available and data is empty, trigger background cache
    if (kv && (!result.results || result.results.length === 0)) {
      // Don't await - let it happen in background
      fetch(new URL('/api/cache-stations', request.url).toString(), {
        method: 'POST'
      }).catch(() => {
        // Silently fail background cache
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching rides:', error);
    return NextResponse.json(
      { error: 'Failed to fetch rides' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from "@opennextjs/cloudflare";

async function handlePrefetch(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const yearMonth = searchParams.get('year_month'); // YYYY-MM format

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

    const [year, month] = yearMonth.split('-');
    const tableName = `rides_${year}${month.padStart(2, '0')}`;

    // Get rides without polylines - limit to prevent timeouts
     const query = `
       SELECT
         ride_id,
         start_station_id,
         end_station_id,
         start_lat,
         start_lng,
         end_lat,
         end_lng
       FROM ${tableName}
       WHERE start_station_id IS NOT NULL
         AND end_station_id IS NOT NULL
         AND start_lat IS NOT NULL
         AND route_polyline IS NULL
       LIMIT 500
      `;

     const result = await db.prepare(query).all() as any;
     const rides = result.results || [];

     if (rides.length === 0) {
       return NextResponse.json({ success: true, total_rides: 0, processed: 0, cached: 0 });
     }

     // Just return the count, don't process - let the frontend decide
     return NextResponse.json({
       success: true,
       total_rides: rides.length,
       processed: 0,
       cached: 0,
       rides: rides
     });
  } catch (error) {
    console.error('Error prefetching routes:', error);
    return NextResponse.json(
      { error: 'Failed to prefetch routes' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handlePrefetch(request);
}

export async function POST(request: NextRequest) {
  return handlePrefetch(request);
}

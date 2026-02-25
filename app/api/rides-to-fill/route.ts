import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function GET(request: NextRequest) {
  try {
    const db = getCloudflareContext().env.baywheels;

    if (!db) {
      return NextResponse.json(
        { error: 'Database binding not found' },
        { status: 500 }
      );
    }

    const query = `
      SELECT ride_id, started_at, start_station_id, end_station_id, route_polyline
      FROM rides
      WHERE route_polyline IS NULL
        AND start_station_id IS NOT NULL
        AND end_station_id IS NOT NULL
      LIMIT 5000
    `;

    const result = await db.prepare(query).all();

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching rides to fill:', error);
    return NextResponse.json(
      { error: 'Failed to fetch rides' },
      { status: 500 }
    );
  }
}

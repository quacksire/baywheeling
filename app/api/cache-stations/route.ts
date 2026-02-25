import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function POST(request: NextRequest) {
  try {
    const { env } = getCloudflareContext();
    const db = env.baywheels;
    const kv = env.baywheel_kv;

    if (!db || !kv) {
      return NextResponse.json(
        { error: 'Database or KV binding not found' },
        { status: 500 }
      );
    }

    // Fetch all stations from D1
    const query = `
      SELECT DISTINCT 
        station_id,
        station_name
      FROM 
        (SELECT start_station_id as station_id, start_station_name as station_name FROM rides
         UNION
         SELECT end_station_id, end_station_name FROM rides)
      WHERE station_id IS NOT NULL
      ORDER BY station_id
    `;

    const result = await db.prepare(query).all() as any;
    const stations = result.results || [];

    // Cache each station in KV
    const kvPromises = stations.map(async (station) => {
      const stationKey = `station:${station.station_id}`;
      return kv.put(stationKey, station.station_name);
    });

    await Promise.allSettled(kvPromises);

    return NextResponse.json({
      success: true,
      cached: stations.length
    });
  } catch (error) {
    console.error('Error caching stations:', error);
    return NextResponse.json(
      { error: 'Failed to cache stations' },
      { status: 500 }
    );
  }
}

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

    // Get all month tables
    const tableQuery = `
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name LIKE 'rides_%'
      ORDER BY name DESC
    `;
    
    const tableResult = await db.prepare(tableQuery).all() as any;
    const tables = (tableResult.results || []).map((r: any) => r.name);

    if (tables.length === 0) {
      return NextResponse.json({ cached: 0 });
    }

    // Build union of all month tables
    const selectStatements = tables.map(
      (table) => `SELECT start_station_id as station_id, start_station_name as station_name FROM ${table}
       UNION
       SELECT end_station_id, end_station_name FROM ${table}`
    );

    const query = `
      SELECT DISTINCT 
        station_id,
        station_name
      FROM 
        (${selectStatements.join(' UNION ')})
      WHERE station_id IS NOT NULL
      ORDER BY station_id
    `;

    const result = await db.prepare(query).all() as any;
    const stations = result.results || [];

    // Cache each station in KV
    const kvPromises = stations.map(async (station: any) => {
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

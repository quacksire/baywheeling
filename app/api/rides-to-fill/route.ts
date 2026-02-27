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

    // Get all month tables
    const tableQuery = `
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name LIKE 'rides_%'
      ORDER BY name DESC
    `;
    
    const tableResult = await db.prepare(tableQuery).all() as any;
    const tables = (tableResult.results || []).map((r: any) => r.name);

    if (tables.length === 0) {
      return NextResponse.json({ results: [] });
    }

    // Query all month tables with UNION
    const selectStatements = tables.map(
      (table: string) => `SELECT ride_id, started_at, start_station_id, end_station_id, route_polyline FROM ${table}
        WHERE route_polyline IS NULL
          AND start_station_id IS NOT NULL
          AND end_station_id IS NOT NULL`
    );

    const query = selectStatements.join(' UNION ALL ') + ' LIMIT 5000';

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

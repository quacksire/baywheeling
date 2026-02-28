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

    // Query each table separately to avoid SQLite's compound SELECT limit
     const allResults: any[] = [];

     for (const table of tables) {
       const query = `
         SELECT ride_id, started_at, start_station_id, end_station_id, route_polyline
         FROM ${table}
         WHERE route_polyline IS NULL
           AND start_station_id IS NOT NULL
           AND end_station_id IS NOT NULL
         LIMIT 500
       `;

       try {
         const result = await db.prepare(query).all() as any;
         if (result.results) {
           allResults.push(...result.results);
         }
       } catch (err) {
         console.warn(`Error querying ${table}:`, err);
       }

       if (allResults.length >= 5000) {
         break;
       }
     }

     return NextResponse.json({ results: allResults.slice(0, 5000) });
  } catch (error) {
    console.error('Error fetching rides to fill:', error);
    return NextResponse.json(
      { error: 'Failed to fetch rides' },
      { status: 500 }
    );
  }
}

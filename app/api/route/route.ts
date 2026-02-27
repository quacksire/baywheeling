import { NextRequest, NextResponse } from 'next/server';
import { polyline } from '@/lib/polyline';
import {getCloudflareContext} from "@opennextjs/cloudflare";

export async function GET(request: NextRequest, context: any) {
   const { searchParams } = new URL(request.url);
   const startLon = searchParams.get('start_lon');
   const startLat = searchParams.get('start_lat');
   const endLon = searchParams.get('end_lon');
   const endLat = searchParams.get('end_lat');
   const startStationId = searchParams.get('start_station_id');
   const endStationId = searchParams.get('end_station_id');
   const rideId = searchParams.get('ride_id');

  if (!startLon || !startLat || !endLon || !endLat) {
    return NextResponse.json(
      { error: 'start_lon, start_lat, end_lon, end_lat are required' },
      { status: 400 }
    );
  }

  try {
     const { env } = getCloudflareContext();
     const db = env.baywheels;
     const kv = env.baywheel_kv;
     let polylineStr: string | null = null;

    // Try to get from D1 cache first (only if ride_id is provided)
    if (db && rideId) {
      try {
        // Query all month tables to find the ride
        const tableQuery = `
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name LIKE 'rides_%'
          ORDER BY name DESC
        `;
        
        const tableResult = await db.prepare(tableQuery).all() as any;
        const tables = (tableResult.results || []).map((r: any) => r.name);
        
        for (const table of tables) {
          const result = await db
            .prepare(`SELECT route_polyline FROM ${table} WHERE ride_id = ?`)
            .bind(rideId)
            .first();

          if (result?.route_polyline) {
            console.log('Route found in D1');
            polylineStr = result.route_polyline as string;
            const geojsonGeometry = polyline.toGeoJSON(polylineStr);
            return NextResponse.json({
              routes: [
                {
                  geometry: geojsonGeometry,
                  duration: 0,
                  distance: 0
                }
              ]
            });
          }
        }
      } catch (dbError) {
        console.warn('D1 cache read error:', dbError);
      }
    }

    // Fetch from OSRM if not in cache
    const url = `https://router.project-osrm.org/route/v1/cycling/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=polyline`;
    
    console.log('Fetching route from OSRM:', url);

    const response = await fetch(url, {
      cf: {
        cacheTtl: 3600,
        cacheEverything: true
      }
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`OSRM API error: ${response.status}`, text);
      throw new Error(`OSRM API error: ${response.status}`);
    }

    const data = await response.json() as any;

    if (data.routes?.length > 0) {
      const route = data.routes[0];

      // Save polyline to D1 and KV - only if ride_id is provided
      if (rideId && route.geometry) {
        // Update all month tables (since we don't know which one has the ride)
        if (db) {
          try {
            const tableQuery = `
              SELECT name FROM sqlite_master 
              WHERE type='table' AND name LIKE 'rides_%'
            `;
            
            const tableResult = await db.prepare(tableQuery).all() as any;
            const tables = (tableResult.results || []).map((r: any) => r.name);
            
            let updated = false;
            for (const table of tables) {
              const result = await db
                .prepare(`UPDATE ${table} SET route_polyline = ? WHERE ride_id = ?`)
                .bind(route.geometry, rideId)
                .run();
              if ((result as any).success) {
                updated = true;
              }
            }
            
            if (updated) {
              console.log('Route cached in D1');
            }
          } catch (dbError) {
            console.warn('D1 cache write error:', dbError);
          }
        }

        // Also cache in KV by station pair (start_station_id:end_station_id)
         if (kv && startStationId && endStationId) {
           try {
             const routeKey = `route:${startStationId}:${endStationId}`;
             await kv.put(routeKey, route.geometry);
             console.log('Route cached in KV with key:', routeKey);
           } catch (kvError) {
             console.warn('KV cache write error:', kvError);
           }
         }
      }

      // Convert polyline to GeoJSON for response
      const geojsonGeometry = polyline.toGeoJSON(route.geometry);

      return NextResponse.json({
        routes: [
          {
            geometry: geojsonGeometry,
            duration: route.duration,
            distance: route.distance
          }
        ]
      });
    }

    return NextResponse.json({ routes: [] });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error fetching route from OSRM:', errorMsg, 'Stack:', error instanceof Error ? error.stack : '');
    return NextResponse.json(
      { error: `Failed to fetch route: ${errorMsg}` },
      { status: 500 }
    );
  }
}

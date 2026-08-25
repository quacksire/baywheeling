import { NextRequest, NextResponse } from 'next/server';
import { polyline } from '@/lib/polyline';
import {getCloudflareContext} from "@opennextjs/cloudflare";

async function cacheReverseRoute(kv: any, db: any, startStationId: string | null, endStationId: string | null, geometry: string) {
  if (!startStationId || !endStationId) return;

  try {
    // Cache in KV by reversed station pair
    if (kv) {
      const reverseRouteKey = `route:${endStationId}:${startStationId}`;
      await kv.put(reverseRouteKey, geometry);
      console.log('Reverse route cached in KV with key:', reverseRouteKey);
    }

    // Cache in D1 across all tables
    if (db) {
      const tableQuery = `
        SELECT name FROM sqlite_master
        WHERE type='table' AND name LIKE 'rides_%'
      `;

      const tableResult = await db.prepare(tableQuery).all() as any;
      const tables = (tableResult.results || []).map((r: any) => r.name);

      for (const table of tables) {
        await db
          .prepare(`UPDATE ${table} SET route_polyline = ? WHERE start_station_id = ? AND end_station_id = ?`)
          .bind(geometry, endStationId, startStationId)
          .run().then((result: any) => {
            if (result.success) {
                console.log(`Reverse route cached in D1 for table ${table} (end_station_id: ${endStationId}, start_station_id: ${startStationId})`);
            }
            }).catch((error: any) => {
                console.warn(`Failed to cache reverse route in D1 for table ${table}:`, error);
            })
        await db
            .prepare(`UPDATE ${table} SET route_polyline = ? WHERE start_station_id = ? AND end_station_id = ?`)
            .bind(geometry, startStationId, endStationId)
            .run().then((result: any) => {
              if (result.success) {
                console.log(`Reverse route cached in D1 for table ${table} (end_station_id: ${endStationId}, start_station_id: ${startStationId})`);
              }
            }).catch((error: any) => {
              console.warn(`Failed to cache reverse route in D1 for table ${table}:`, error);
            })
      }
      console.log('Reverse route cached in D1');
    }
  } catch (error) {
    console.warn('Failed to cache reverse route:', error);
  }
}

async function cacheRouteInD1(
  db: any,
  geometry: string,
  rideId: string | null,
  startStationId: string | null,
  endStationId: string | null,
  targetTable?: string | null,
) {
  if (!db) return;

  try {
    let tables: string[];
    if (targetTable) {
      tables = [targetTable];
    } else {
      const tableQuery = `
        SELECT name FROM sqlite_master
        WHERE type='table' AND name LIKE 'rides_%'
      `;

      const tableResult = await db.prepare(tableQuery).all() as any;
      tables = (tableResult.results || []).map((r: any) => r.name);
    }

    for (const table of tables) {
      if (rideId) {
        await db
          .prepare(`UPDATE ${table} SET route_polyline = ? WHERE ride_id = ?`)
          .bind(geometry, rideId)
          .run()
          .catch((error: any) => {
            console.warn(`Failed to cache ride route in D1 for table ${table}:`, error);
          });
      }

      if (startStationId && endStationId) {
        await db
          .prepare(`UPDATE ${table} SET route_polyline = ? WHERE start_station_id = ? AND end_station_id = ?`)
          .bind(geometry, startStationId, endStationId)
          .run()
          .catch((error: any) => {
            console.warn(`Failed to cache pair route in D1 for table ${table}:`, error);
          });
      }
    }
  } catch (error) {
    console.warn('D1 cache write error:', error);
  }
}

function rideTableFromYearMonth(yearMonth: string | null) {
  if (!yearMonth) return null;
  const normalized = yearMonth.replace("-", "");
  return /^\d{6}$/.test(normalized) ? `rides_${normalized}` : null;
}

function routeResponse(polylineStr: string, duration = 0, distance = 0) {
  const geojsonGeometry = polyline.toGeoJSON(polylineStr);
  return NextResponse.json({
    routes: [
      {
        geometry: geojsonGeometry,
        duration,
        distance
      }
    ]
  }, {
    headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    cf: { cacheTtl: 3600, cacheEverything: true }
  });
}

export async function GET(request: NextRequest, context: any) {
   const { searchParams } = new URL(request.url);
   const startLon = searchParams.get('start_lon');
   const startLat = searchParams.get('start_lat');
   const endLon = searchParams.get('end_lon');
   const endLat = searchParams.get('end_lat');
   const startStationId = searchParams.get('start_station_id');
   const endStationId = searchParams.get('end_station_id');
   const rideId = searchParams.get('ride_id');
   const targetRideTable = rideTableFromYearMonth(searchParams.get('year_month'));

  if (!startLon || !startLat || !endLon || !endLat) {
    return NextResponse.json(
      { error: 'start_lon, start_lat, end_lon, end_lat are required' },
      { status: 400 }
    );
  }

  try {
     const { env, ctx } = getCloudflareContext();
     const db = env.baywheels;
     const kv = env.baywheel_kv;
     let polylineStr: string | null = null;
     const cacheRouteInD1Async = (geometry: string) => {
       ctx.waitUntil(
         cacheRouteInD1(db, geometry, rideId, startStationId, endStationId, targetRideTable).catch((error) => {
           console.warn('Async D1 route cache write failed:', error);
         }),
       );
     };

    // Try to get from KV cache first (by station pair)
    if (kv && startStationId && endStationId) {
      try {
        const routeKey = `route:${startStationId}:${endStationId}`;
        const kvRoute = await kv.get(routeKey);
        if (kvRoute) {
          console.log('Route found in KV');
          cacheRouteInD1Async(kvRoute);
          cacheReverseRoute(kv, null, startStationId, endStationId, kvRoute);
          return routeResponse(kvRoute);
        } else {
          // this might be faster than fetching from OSRM if the route exists in reverse direction (since it's a bike route, it might be common)
          const reversed_routeKey = `route:${endStationId}:${startStationId}`;
          const reversed_kvRoute = await kv.get(reversed_routeKey);
          if (reversed_kvRoute) {
            console.log('Route found in KV');
            cacheRouteInD1Async(reversed_kvRoute);
            return routeResponse(reversed_kvRoute);
          }
        }



      } catch (kvError) {
        console.warn('KV cache read error:', kvError);
      }
    }

    // Try the imported D1 route cache before calling OSRM.
    if (db && (rideId || (startStationId && endStationId))) {
      try {
        let tables: string[];
        if (targetRideTable) {
          tables = [targetRideTable];
        } else {
          const tableQuery = `
            SELECT name FROM sqlite_master
            WHERE type='table' AND name LIKE 'rides_%'
            ORDER BY name DESC
          `;

          const tableResult = await db.prepare(tableQuery).all() as any;
          tables = (tableResult.results || []).map((r: any) => r.name);
        }

        for (const table of tables) {
          const result = rideId
            ? await db.prepare(`SELECT route_polyline FROM ${table} WHERE ride_id = ?`).bind(rideId).first()
            : await db
              .prepare(`SELECT route_polyline FROM ${table} WHERE start_station_id = ? AND end_station_id = ? AND route_polyline IS NOT NULL LIMIT 1`)
              .bind(startStationId, endStationId)
              .first();

          if (result?.route_polyline) {
            console.log('Route found in D1');
            polylineStr = result.route_polyline as string;
            cacheRouteInD1Async(polylineStr);
            return routeResponse(polylineStr);
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

      // Save polyline to caches without blocking the response on D1 writes.
      if (rideId && route.geometry) {
        cacheRouteInD1Async(route.geometry);

        // Also cache in KV by station pair (start_station_id:end_station_id)
         if (kv && startStationId && endStationId) {
           try {
             const routeKey = `route:${startStationId}:${endStationId}`;
             await kv.put(routeKey, route.geometry);
             console.log('Route cached in KV with key:', routeKey);

             // Cache reverse route asynchronously (non-blocking)
             cacheReverseRoute(kv, null, startStationId, endStationId, route.geometry);
           } catch (kvError) {
             console.warn('KV cache write error:', kvError);
           }
         }
        }

      if (route.geometry) {
        cacheRouteInD1Async(route.geometry);
      }

      // Convert polyline to GeoJSON for response
      return routeResponse(route.geometry, route.duration, route.distance);
    }

    return NextResponse.json({ routes: [] }, {
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error fetching route from OSRM:', errorMsg, 'Stack:', error instanceof Error ? error.stack : '');
    return NextResponse.json(
      { error: `Failed to fetch route: ${errorMsg}` },
      { status: 500 }
    );
  }
}

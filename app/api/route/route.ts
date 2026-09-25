import { NextRequest, NextResponse } from 'next/server';
import { polyline } from '@/lib/polyline';
import {getCloudflareContext} from "@opennextjs/cloudflare";

async function cacheReverseRoute(kv: any, startStationId: string | null, endStationId: string | null, geometry: string) {
  if (!startStationId || !endStationId) return;

  try {
    if (kv) {
      const reverseRouteKey = `route:${endStationId}:${startStationId}`;
      await kv.put(reverseRouteKey, geometry);
    }
  } catch (error) {
    console.warn('Failed to cache reverse route:', error);
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

export async function GET(request: NextRequest) {
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
     const { env } = getCloudflareContext();
     const db = env.baywheels;
     const kv = env.baywheel_kv;
     let polylineStr: string | null = null;

    // Try to get from KV cache first (by station pair)
    if (kv && startStationId && endStationId) {
      try {
        const routeKey = `route:${startStationId}:${endStationId}`;
        const kvRoute = await kv.get(routeKey);
        if (kvRoute) {
          console.log('Route found in KV');
          cacheReverseRoute(kv, startStationId, endStationId, kvRoute);
          return routeResponse(kvRoute);
        } else {
          // this might be faster than fetching from OSRM if the route exists in reverse direction (since it's a bike route, it might be common)
          const reversed_routeKey = `route:${endStationId}:${startStationId}`;
          const reversed_kvRoute = await kv.get(reversed_routeKey);
          if (reversed_kvRoute) {
            console.log('Route found in KV');
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
            if (kv && startStationId && endStationId) {
              await kv.put(`route:${startStationId}:${endStationId}`, polylineStr);
            }
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

      if (route.geometry && kv && startStationId && endStationId) {
        try {
          await kv.put(`route:${startStationId}:${endStationId}`, route.geometry);
          cacheReverseRoute(kv, startStationId, endStationId, route.geometry);
        } catch (kvError) {
          console.warn('KV cache write error:', kvError);
        }
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

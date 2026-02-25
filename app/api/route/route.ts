import { NextRequest, NextResponse } from 'next/server';
import { polyline } from '@/lib/polyline';
import {getCloudflareContext} from "@opennextjs/cloudflare";

export async function GET(request: NextRequest, context: any) {
  const { searchParams } = new URL(request.url);
  const startLon = searchParams.get('start_lon');
  const startLat = searchParams.get('start_lat');
  const endLon = searchParams.get('end_lon');
  const endLat = searchParams.get('end_lat');
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
    let polylineStr: string | null = null;

    // Try to get from D1 cache first (only if ride_id is provided)
    if (db && rideId) {
      try {
        const result = await db
          .prepare('SELECT route_polyline FROM rides WHERE ride_id = ?')
          .bind(rideId)
          .first();

        if (result?.route_polyline) {
          console.log('Route found in D1');
          polylineStr = result.route_polyline;
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
      } catch (dbError) {
        console.warn('D1 cache read error:', dbError);
      }
    }

    // Fetch from OSRM if not in cache
    const url = `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=polyline`;

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

    const data = await response.json();

    if (data.routes?.length > 0) {
      const route = data.routes[0];

      // Save polyline to D1 - only if ride_id is provided
      if (db && rideId && route.geometry) {
        try {
          await db
            .prepare('UPDATE rides SET route_polyline = ? WHERE ride_id = ?')
            .bind(route.geometry, rideId)
            .run();
          console.log('Route cached in D1');
        } catch (dbError) {
          console.warn('D1 cache write error:', dbError);
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

import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      ride_id: string;
      start_lon: number;
      start_lat: number;
      end_lon: number;
      end_lat: number;
      start_station_id: string;
      end_station_id: string;
    };
    const { ride_id, start_lon, start_lat, end_lon, end_lat, start_station_id, end_station_id } = body;

    if (!ride_id || start_lon === undefined || start_lat === undefined || end_lon === undefined || end_lat === undefined) {
      return NextResponse.json(
        { error: 'ride_id, start_lon, start_lat, end_lon, end_lat are required' },
        { status: 400 }
      );
    }

    const { env } = getCloudflareContext();
    const db = env.baywheels;
    const kv = env.baywheel_kv;

    if (!db || !kv) {
      return NextResponse.json(
        { error: 'Database or KV binding not found' },
        { status: 500 }
      );
    }

    const routeKey = `route:${start_station_id}:${end_station_id}`;

    // Check KV first
    let polyline = await kv.get(routeKey);

    if (!polyline) {
      // Fetch from OSRM
      const osrmUrl = `https://router.project-osrm.org/route/v1/cycling/${start_lon},${start_lat};${end_lon},${end_lat}?overview=full&geometries=polyline`;

      let osrmResponse;
      try {
        osrmResponse = await fetch(osrmUrl);
      } catch (fetchErr) {
        console.error('OSRM fetch error:', fetchErr);
        return NextResponse.json(
          { error: 'Failed to fetch from OSRM' },
          { status: 503 }
        );
      }

      if (!osrmResponse.ok) {
        console.error(`OSRM API error: ${osrmResponse.status}`);
        return NextResponse.json(
          { error: `OSRM error: ${osrmResponse.status}` },
          { status: osrmResponse.status }
        );
      }

      let osrmData;
      try {
        osrmData = await osrmResponse.json() as { routes: Array<{ geometry: string }> };
      } catch (parseErr) {
        console.error('Failed to parse OSRM response:', parseErr);
        return NextResponse.json(
          { error: 'Invalid OSRM response' },
          { status: 502 }
        );
      }

      if (!osrmData.routes?.length || !osrmData.routes[0].geometry) {
        console.warn('No route found in OSRM response');
        return NextResponse.json(
          { error: 'No route found' },
          { status: 400 }
        );
      }

      polyline = osrmData.routes[0].geometry;

      // Cache in KV
      await kv.put(routeKey, polyline);
    }

    // Save to D1
    await db
      .prepare('UPDATE rides SET route_polyline = ? WHERE ride_id = ?')
      .bind(polyline, ride_id)
      .run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving polyline:', error);
    return NextResponse.json(
      { error: 'Failed to save polyline' },
      { status: 500 }
    );
  }
}

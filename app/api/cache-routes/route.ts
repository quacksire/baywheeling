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

    // Fetch all rides with polylines
    const query = `
      SELECT DISTINCT start_station_id, end_station_id, route_polyline
      FROM rides
      WHERE route_polyline IS NOT NULL
        AND start_station_id IS NOT NULL
        AND end_station_id IS NOT NULL
      LIMIT 10000
    `;

    const result = await db.prepare(query).all() as any;
    const routes = result.results || [];

    // Stream progress via ReadableStream
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const batchSize = 50;
          const totalRoutes = routes.length;

          for (let i = 0; i < routes.length; i += batchSize) {
            const batch = routes.slice(i, i + batchSize);
            
            // Send progress update
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({ current: i, total: totalRoutes }) + '\n'
              )
            );

            // Cache batch in parallel
            const kvPromises = batch.map(async (route: any) => {
              const routeKey = `route:${route.start_station_id}:${route.end_station_id}`;
              return kv.put(routeKey, route.route_polyline);
            });

            await Promise.allSettled(kvPromises);
          }

          // Final completion message
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({ success: true, total: totalRoutes, cached: totalRoutes, current: totalRoutes }) + '\n'
            )
          );

          controller.close();
        } catch (error) {
          controller.error(error);
        }
      }
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked'
      }
    });
  } catch (error) {
    console.error('Error caching routes:', error);
    return NextResponse.json(
      { error: 'Failed to cache routes' },
      { status: 500 }
    );
  }
}

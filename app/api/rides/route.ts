import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from "@opennextjs/cloudflare";

type RouteCount = {
  end_station_id: string;
  end_station_name: string | null;
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  route_polyline?: string | null;
  ride_count: number;
};

type CachedStationStats = {
  total_rides?: number;
  routeCounts?: RouteCount[];
};

function routeResults(stationId: string, routes: RouteCount[], totalRideCount: number) {
  return {
    results: routes.map((route) => ({
      start_station_id: stationId,
      end_station_id: route.end_station_id,
      end_station_name: route.end_station_name,
      start_lat: route.start_lat,
      start_lng: route.start_lng,
      end_lat: route.end_lat,
      end_lng: route.end_lng,
      route_polyline: route.route_polyline ?? null,
      ride_count: route.ride_count,
    })),
    total_ride_count: totalRideCount,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const stationId = searchParams.get('station_id');
  const yearMonth = searchParams.get('year_month');

  if (!stationId) {
    return NextResponse.json(
      { error: 'station_id is required' },
      { status: 400 }
    );
  }

  if (!yearMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
    return NextResponse.json(
      { error: 'year_month is required in YYYY-MM format' },
      { status: 400 }
    );
  }

  try {
    const { env, ctx } = getCloudflareContext();
    const db = env.baywheels;
    const kv = env.baywheel_kv;
    const stationStatsKey = `station-stats:v1:${yearMonth}:${stationId}`;
    const stationRoutesKey = `station-routes:v1:${yearMonth}:${stationId}`;
    const monthReadyKey = `station-stats:v1:${yearMonth}:_ready`;

    if (kv) {
      try {
        const [cachedStats, cachedRoutes, monthReady] = await Promise.all([
          kv.get(stationStatsKey, 'json') as Promise<CachedStationStats | null>,
          kv.get(stationRoutesKey, 'json') as Promise<RouteCount[] | null>,
          kv.get(monthReadyKey),
        ]);

        const routes = Array.isArray(cachedStats?.routeCounts)
          ? cachedStats.routeCounts
          : cachedRoutes;
        if (Array.isArray(routes)) {
          return NextResponse.json(routeResults(stationId, routes, cachedStats?.total_rides ?? 0));
        }
        if (!cachedStats && monthReady) {
          return NextResponse.json({ results: [], total_ride_count: 0 });
        }
      } catch (error) {
        console.warn('Station route-count cache unavailable; querying ride data:', error);
      }
    }

    if (!db) {
      return NextResponse.json({ results: [], total_ride_count: 0 });
    }

    const tableName = `rides_${yearMonth.replace('-', '')}`;
    const result = await db.prepare(`
      SELECT end_station_id,
             MAX(end_station_name) AS end_station_name,
             MAX(start_lat) AS start_lat,
             MAX(start_lng) AS start_lng,
             MAX(end_lat) AS end_lat,
             MAX(end_lng) AS end_lng,
             MAX(route_polyline) AS route_polyline,
             COUNT(*) AS ride_count
      FROM ${tableName}
      WHERE start_station_id = ?
        AND end_station_id IS NOT NULL
        AND end_station_id <> ''
      GROUP BY end_station_id
      ORDER BY ride_count DESC
    `).bind(stationId).all<RouteCount>();

    const routes = result.results || [];
    if (kv) {
      const cachedRoutes = routes.map(({ route_polyline: _routePolyline, ...route }) => route);
      const writes = [kv.put(stationRoutesKey, JSON.stringify(cachedRoutes))];
      for (const route of routes) {
        if (route.route_polyline) {
          writes.push(kv.put(`route:${stationId}:${route.end_station_id}`, route.route_polyline));
        }
      }
      ctx.waitUntil(Promise.all(writes).catch((error) => {
        console.warn('Could not cache station route counts:', error);
      }));
    }

    return NextResponse.json(routeResults(stationId, routes, routes.reduce((total, route) => total + route.ride_count, 0)));
  } catch (error) {
    console.error('Error fetching route counts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch station routes' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from "@opennextjs/cloudflare";

type StatsMessage = { type: string; data?: unknown };
type StationStatsSnapshot = {
  total_rides: number;
  member_count: number;
  casual_count: number;
  false_starts: number;
  avg_ride_seconds: number | null;
  longest_ride_seconds: number | null;
  rideableTypes: Array<{ rideable_type: string | null; count: number }>;
  dayOfWeek: Array<{ day_num: string | null; count: number }>;
  destinations: Array<{ end_station_name: string | null; count: number }>;
  busiestHours: Array<{ hour: string | null; count: number }>;
  routeCounts: Array<{ end_station_id: string; end_station_name: string | null; ride_count: number }>;
};

function statsResponse(messages: StatsMessage[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const message of messages) {
        controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
      }
      controller.close();
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
    },
  });
}

function stationStatsMessages(stats: StationStatsSnapshot): StatsMessage[] {
  const { routeCounts: _routeCounts, ...visibleStats } = stats;
  return [
    { type: 'stats', data: visibleStats },
    { type: 'rideableTypes', data: stats.rideableTypes },
    { type: 'dayOfWeek', data: stats.dayOfWeek },
    { type: 'destinations', data: stats.destinations },
    { type: 'busiestHours', data: stats.busiestHours },
    { type: 'complete' },
  ];
}

const emptyStats = (): StationStatsSnapshot => ({
  total_rides: 0,
  member_count: 0,
  casual_count: 0,
  false_starts: 0,
  avg_ride_seconds: null,
  longest_ride_seconds: null,
  rideableTypes: [],
  dayOfWeek: [],
  destinations: [],
  busiestHours: [],
  routeCounts: [],
});

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

    if (!db && !kv) {
      return NextResponse.json(
        { error: 'Stats data source not found' },
        { status: 500 }
      );
    }

    const statsCacheKey = `station-stats:v1:${yearMonth}:${stationId}`;
    const readyCacheKey = `station-stats:v1:${yearMonth}:_ready`;
    const durationCacheKey = `station-duration:v1:${yearMonth}:${stationId}`;
    if (kv) {
      try {
        const [cachedStats, cachedMonthReady] = await Promise.all([
          kv.get(statsCacheKey, 'json') as Promise<StationStatsSnapshot | null>,
          kv.get(readyCacheKey),
        ]);
        if (cachedStats) {
          let stats = cachedStats;
          if (stats.avg_ride_seconds === undefined || stats.longest_ride_seconds === undefined) {
            let durations = await kv.get(durationCacheKey, 'json') as {
              avg_ride_seconds: number | null;
              longest_ride_seconds: number | null;
            } | null;

            if (!durations && db) {
              const tableName = `rides_${yearMonth.replace('-', '')}`;
              const result = await db.prepare(`
                SELECT AVG(CASE WHEN julianday(ended_at) > julianday(started_at)
                    THEN (julianday(ended_at) - julianday(started_at)) * 86400 END) as avg_ride_seconds,
                       MAX(CASE WHEN julianday(ended_at) > julianday(started_at)
                    THEN (julianday(ended_at) - julianday(started_at)) * 86400 END) as longest_ride_seconds
                FROM ${tableName}
                WHERE start_station_id = ?
              `).bind(stationId).first<{
                avg_ride_seconds: number | null;
                longest_ride_seconds: number | null;
              }>();
              durations = {
                avg_ride_seconds: result?.avg_ride_seconds == null ? null : Math.round(result.avg_ride_seconds),
                longest_ride_seconds: result?.longest_ride_seconds == null ? null : Math.round(result.longest_ride_seconds),
              };
              ctx.waitUntil(
                kv.put(durationCacheKey, JSON.stringify(durations)).catch((error) => {
                  console.warn('Could not cache station ride durations:', error);
                })
              );
            }

            stats = {
              ...stats,
              avg_ride_seconds: durations?.avg_ride_seconds ?? null,
              longest_ride_seconds: durations?.longest_ride_seconds ?? null,
            };
          }
          return statsResponse(stationStatsMessages(stats));
        }
        if (cachedMonthReady) return statsResponse(stationStatsMessages(emptyStats()));
      } catch (error) {
        console.warn('Station stats cache unavailable; querying ride data:', error);
      }
    }

    if (!db) {
      return NextResponse.json({ error: 'Stats are not available for this month' }, { status: 404 });
    }

    const tableName = `rides_${yearMonth.replace('-', '')}`;
    const whereClause = `WHERE start_station_id = ?`;
    const params = [stationId];

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const enqueue = (message: StatsMessage) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
        };

        try {
          const result = await db
            .prepare(
              `SELECT
                COUNT(*) as total_rides,
                SUM(CASE WHEN member_casual = 'member' THEN 1 ELSE 0 END) as member_count,
                SUM(CASE WHEN member_casual = 'casual' THEN 1 ELSE 0 END) as casual_count,
                SUM(CASE WHEN end_station_id = start_station_id THEN 1 ELSE 0 END) as false_starts,
                AVG(CASE WHEN julianday(ended_at) > julianday(started_at)
                    THEN (julianday(ended_at) - julianday(started_at)) * 86400 END) as avg_ride_seconds,
                MAX(CASE WHEN julianday(ended_at) > julianday(started_at)
                    THEN (julianday(ended_at) - julianday(started_at)) * 86400 END) as longest_ride_seconds
               FROM ${tableName}
               ${whereClause}`
            )
            .bind(...params)
            .first();

          enqueue({ type: 'stats', data: result });

          const rideableTypes = await db
            .prepare(
              `SELECT rideable_type, COUNT(*) as count
               FROM ${tableName}
               ${whereClause}
               GROUP BY rideable_type
               ORDER BY count DESC`
            )
            .bind(...params)
            .all();

          enqueue({ type: 'rideableTypes', data: rideableTypes.results || [] });

          const dayOfWeek = await db
            .prepare(
              `SELECT strftime('%w', substr(started_at, 1, 10)) as day_num, COUNT(*) as count
               FROM ${tableName}
               ${whereClause}
               GROUP BY day_num
               ORDER BY CAST(day_num as INTEGER)`
            )
            .bind(...params)
            .all();

          enqueue({ type: 'dayOfWeek', data: dayOfWeek.results || [] });

          const destinations = await db
            .prepare(
              `SELECT end_station_name, COUNT(*) as count
               FROM ${tableName}
               ${whereClause}
               GROUP BY end_station_name
               ORDER BY count DESC
               LIMIT 5`
            )
            .bind(...params)
            .all();

          enqueue({ type: 'destinations', data: destinations.results || [] });

          const busiestHours = await db
            .prepare(
              `SELECT substr(started_at, 12, 2) as hour, COUNT(*) as count
               FROM ${tableName}
               ${whereClause}
               GROUP BY hour
               ORDER BY CAST(hour as INTEGER)`
            )
            .bind(...params)
            .all();

          enqueue({ type: 'busiestHours', data: busiestHours.results || [] });
          enqueue({ type: 'complete' });
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    console.error('Error fetching station stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}

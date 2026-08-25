import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const stationId = searchParams.get('station_id');
  const yearMonth = searchParams.get('year_month'); // YYYY-MM format (required)

  if (!stationId) {
    return NextResponse.json(
      { error: 'station_id is required' },
      { status: 400 }
    );
  }

  if (!yearMonth) {
    return NextResponse.json(
      { error: 'year_month is required in YYYY-MM format' },
      { status: 400 }
    );
  }

  try {
    const { env } = getCloudflareContext();
    const db = env.baywheels;

    if (!db) {
      return NextResponse.json(
        { error: 'Database binding not found' },
        { status: 500 }
      );
    }

    const tableName = `rides_${yearMonth.replace('-', '')}`;
    const whereClause = `WHERE start_station_id = ?`;
    const params = [stationId];

    // Stream results as they become available
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Get overall stats first (fastest query)
          console.log('Fetching stats from table:', tableName);
          const result = await db
            .prepare(
              `SELECT
                COUNT(*) as total_rides,
                SUM(CASE WHEN member_casual = 'member' THEN 1 ELSE 0 END) as member_count,
                SUM(CASE WHEN member_casual = 'casual' THEN 1 ELSE 0 END) as casual_count,
                SUM(CASE WHEN end_station_id = start_station_id THEN 1 ELSE 0 END) as false_starts
               FROM ${tableName}
               ${whereClause}`
            )
            .bind(...params)
            .first();

          console.log('Stats result:', result);
          const statsLine = JSON.stringify({ type: 'stats', data: result }) + '\n';
          controller.enqueue(new TextEncoder().encode(statsLine));

          // Get rideable type breakdown
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

          const rideableLine = JSON.stringify({ type: 'rideableTypes', data: rideableTypes.results || [] }) + '\n';
          controller.enqueue(new TextEncoder().encode(rideableLine));

          // Get day of week breakdown
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

          const dayLine = JSON.stringify({ type: 'dayOfWeek', data: dayOfWeek.results || [] }) + '\n';
          controller.enqueue(new TextEncoder().encode(dayLine));

          // Get top destinations
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

          const destLine = JSON.stringify({ type: 'destinations', data: destinations.results || [] }) + '\n';
          controller.enqueue(new TextEncoder().encode(destLine));

          // Get busiest hours (hour of day breakdown)
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

          const hoursLine = JSON.stringify({ type: 'busiestHours', data: busiestHours.results || [] }) + '\n';
          controller.enqueue(new TextEncoder().encode(hoursLine));

          const completeLine = JSON.stringify({ type: 'complete' }) + '\n';
          controller.enqueue(new TextEncoder().encode(completeLine));

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
    console.error('Error fetching station stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export async function GET(request: NextRequest) {
  const yearMonth = new URL(request.url).searchParams.get('year_month');

  if (!yearMonth || (yearMonth !== 'latest' && !/^\d{4}-\d{2}$/.test(yearMonth))) {
    return NextResponse.json(
      { error: 'year_month is required in YYYY-MM format' },
      { status: 400 },
    );
  }

  try {
    const { env } = getCloudflareContext();
    const db = env.baywheels;

    if (!db) {
      return NextResponse.json(
        { error: 'Database binding not found' },
        { status: 500 },
      );
    }

    const getStationUsage = (tableName: string) => db
      .prepare(`
        WITH station_events AS (
          SELECT
            start_station_id AS station_id,
            start_station_name AS station_name,
            1 AS starts,
            0 AS ends
          FROM ${tableName}
          WHERE start_station_id IS NOT NULL AND start_station_id != ''

          UNION ALL

          SELECT
            end_station_id AS station_id,
            end_station_name AS station_name,
            0 AS starts,
            1 AS ends
          FROM ${tableName}
          WHERE end_station_id IS NOT NULL AND end_station_id != ''
        )
        SELECT
          station_id,
          COALESCE(MAX(NULLIF(station_name, '')), station_id) AS station_name,
          SUM(starts) AS starts,
          SUM(ends) AS ends,
          CASE
            WHEN station_id LIKE 'SF-%' THEN 'San Francisco'
            WHEN station_id LIKE 'OK-%' THEN 'Oakland'
            WHEN station_id LIKE 'SJ-%' THEN 'San Jose'
            ELSE 'Other'
          END AS city
        FROM station_events
        GROUP BY station_id
        ORDER BY (SUM(starts) + SUM(ends)) DESC, station_name COLLATE NOCASE ASC
      `)
      .all<{
        station_id: string;
        station_name: string;
        starts: number;
        ends: number;
        city: string;
      }>();

    if (yearMonth === 'latest') {
      const tables = await db
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name GLOB 'rides_[0-9][0-9][0-9][0-9][0-9][0-9]'
          ORDER BY name DESC
        `)
        .all<{ name: string }>();

      for (const table of tables.results || []) {
        const match = table.name.match(/^rides_(\d{4})(\d{2})$/);
        if (!match) continue;

        const result = await getStationUsage(table.name);
        if (result.results?.length) {
          return NextResponse.json(
            { yearMonth: `${match[1]}-${match[2]}`, stations: result.results },
            { headers: { 'Cache-Control': 'public, max-age=900, stale-while-revalidate=3600' } },
          );
        }
      }

      return NextResponse.json(
        { yearMonth: null, stations: [] },
        { headers: { 'Cache-Control': 'public, max-age=900, stale-while-revalidate=3600' } },
      );
    }

    const result = await getStationUsage(`rides_${yearMonth.replace('-', '')}`);

    return NextResponse.json(
      { yearMonth, stations: result.results || [] },
      { headers: { 'Cache-Control': 'public, max-age=900, stale-while-revalidate=3600' } },
    );
  } catch (error) {
    console.error('Error fetching station leaderboard:', error);
    return NextResponse.json(
      { error: 'Failed to fetch station leaderboard' },
      { status: 500 },
    );
  }
}

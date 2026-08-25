import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Importing is now a VPS job. Keep the existing read-only UI contract by
 * reporting months that already have a D1 table; the VPS owns live progress.
 */
export async function GET() {
  try {
    const { env } = getCloudflareContext();
    const result = await env.baywheels
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'rides_%' ORDER BY name DESC")
      .all<{ name: string }>();

    const jobs = (result.results ?? []).map(({ name }) => {
      const month = name.slice("rides_".length);
      return {
        month,
        status: "complete",
        started_at: null,
        import_complete: 1,
        total_rows: 0,
        imported_rows: 0,
        routed_rows: 0,
        routes_processed: 0,
        routes_total: 0,
        routes_mapped: 0,
        routes_per_second: null,
        eta_seconds: null,
      };
    });

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error("Failed to read imported month status:", error);
    return NextResponse.json({ jobs: [] }, { status: 200 });
  }
}

import Link from "next/link";

export default function About() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 text-white">
      <div className="max-w-3xl mx-auto px-4 py-12 sm:py-16">
        {/* Header */}
        <div className="mb-12">
          <Link href="/" className="text-blue-400 hover:text-blue-300 mb-4 inline-block">
            ← Back to Map
          </Link>
          <h1 className="text-4xl sm:text-5xl font-bold mb-2">Baywheeling</h1>
          <p className="text-gray-400">A closer look at how BayWheels moves through the Bay.</p>
        </div>

        {/* About Section */}
        <div className="space-y-8 text-gray-300">
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">About</h2>
            <p className="leading-relaxed">
              Baywheeling is a map-first way to explore BayWheels trip patterns. Pick a dock to see ride totals,
              busiest hours, bike mix, and the destinations that show up most often. The data comes from anonymized
              historical trip records published by the system.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">How It Works</h2>
            <p className="leading-relaxed">
              Click any station to open its monthly snapshot. Move across different months to spot seasonal shifts
              and neighborhood patterns. The map pairs station stats with estimated route lines so you can compare
              what changes over time and what stays steady.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">Limitations</h2>
            <ul className="space-y-2">
              <li className="flex gap-3">
                <span className="text-blue-400 flex-shrink-0">•</span>
                <span>
                  <strong>Route geometry:</strong> The data only includes start and end stations. Routes are estimated
                  with OSRM, so the line on the map is a best guess rather than a recorded trip trace.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-blue-400 flex-shrink-0">•</span>
                <span>
                  <strong>Same-station trips:</strong> Rides that start and end at the same station are excluded
                  because there is no reliable way to draw a route for them.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-blue-400 flex-shrink-0">•</span>
                <span>
                  <strong>Data availability:</strong> Historical coverage is limited to the public data released by
                  the bike-share system.
                </span>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">Technical Stack</h2>
            <ul className="space-y-2 text-sm">
              <li className="flex gap-3">
                <span className="text-blue-400 flex-shrink-0">→</span>
                <span><strong>Frontend:</strong> Next.js + TypeScript + TailwindCSS + Maplibre GL</span>
              </li>
              <li className="flex gap-3">
                <span className="text-blue-400 flex-shrink-0">→</span>
                <span><strong>Backend:</strong> Cloudflare Workers</span>
              </li>
              <li className="flex gap-3">
                <span className="text-blue-400 flex-shrink-0">→</span>
                <span><strong>Database:</strong> Cloudflare D1 (SQLite)</span>
              </li>
              <li className="flex gap-3">
                <span className="text-blue-400 flex-shrink-0">→</span>
                <span><strong>Caching:</strong> Cloudflare KV + HTTP cache</span>
              </li>
              <li className="flex gap-3">
                <span className="text-blue-400 flex-shrink-0">→</span>
                <span><strong>Routing:</strong> OSRM (Open Source Routing Machine)</span>
              </li>
              <li className="flex gap-3">
                <span className="text-blue-400 flex-shrink-0">→</span>
                <span><strong>Visualization:</strong> Deck.gl + Dither Kit</span>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">Why</h2>
            <p className="leading-relaxed">
              I built this project as a student at San Jose State University to combine data visualization, web
              development, and curiosity about how people move around the Bay. It is both a technical playground and
              a local map of patterns that are easy to miss in a spreadsheet.
            </p>
          </section>

          <section className="pt-4 border-t border-gray-700">
            <p className="text-sm text-gray-500">
              Not affiliated with Baywheels, Lyft, or Motivate. Data is publicly available and anonymized.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

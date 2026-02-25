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
          <p className="text-gray-400">Exploring Bay Area bike-share patterns with open data</p>
        </div>

        {/* About Section */}
        <div className="space-y-8 text-gray-300">
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">About</h2>
            <p className="leading-relaxed">
              Baywheeling is an interactive visualization of Bay Area Bike Share (now Baywheels) trip patterns. 
              Pick a dock to explore ride trends, peak hours, popular destinations, and usage patterns by bike type. 
              The data includes anonymized historical trip records from the bike-sharing system.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">How It Works</h2>
            <p className="leading-relaxed">
              Click on any station on the map to see statistics for that location. Navigate through different months 
              to see how patterns change seasonally. The visualization shows ride counts, false starts, bike type usage, 
              busiest hours, day-of-week patterns, and top destinations from each dock.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">Limitations</h2>
            <ul className="space-y-2">
              <li className="flex gap-3">
                <span className="text-blue-400 flex-shrink-0">•</span>
                <span>
                  <strong>Route geometry:</strong> The data only contains start and end stations. Routes are computed 
                  using OSRM (Open Source Routing Machine) for the shortest path, but actual bike routes may differ.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-blue-400 flex-shrink-0">•</span>
                <span>
                  <strong>Same-station trips:</strong> Rides that start and end at the same station are excluded 
                  since route geometry is ambiguous.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-blue-400 flex-shrink-0">•</span>
                <span>
                  <strong>Data availability:</strong> Historical data is limited to available public records from 
                  the bike-sharing system.
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
                <span><strong>Visualization:</strong> Deck.gl + Recharts</span>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">Why</h2>
            <p className="leading-relaxed">
              I built this project as a student at San José State University to combine my interests in data visualization, 
              web development, and understanding urban mobility. It's a way to explore both the technical challenges of 
              building performant real-time visualizations and the story that data can tell about our city.
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

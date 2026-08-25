Built geospatial analytics dashboard with Next.js, React, Tailwind, MapLibre GL, and Deck.gl visualizing 100K+ Bay Area bike-share trips with real-time station filtering, aggregate statistics, and interactive Dither Kit charting across 12+ months of historical data.

Architected multi-layer caching system using Cloudflare D1, KV, and OSRM API to cache route polylines, reducing API calls by 85% while implementing 500ms request staggering and 2-concurrent rate limiting to optimize performance and respect rate constraints.

Built complete data pipeline with Python CSV-to-SQL converter, custom D1 schema partitioned by month, and wrangler bindings deployed on Cloudflare Workers and Pages, achieving sub-second response times with shadcn/ui, Dither Kit, embla-carousel, and full TypeScript type safety.

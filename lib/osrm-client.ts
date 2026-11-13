/**
 * OSRM client with rate limiting to respect the 1 request/second limit
 * See: https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/
 */

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000; // 1 second in milliseconds

export async function fetchOSRMRoute(
  startLon: number,
  startLat: number,
  endLon: number,
  endLat: number,
  options: RequestInit = {}
): Promise<Response> {
  // Wait to enforce rate limit
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve =>
      setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest)
    );
  }
  
  lastRequestTime = Date.now();

  const url = `https://router.project-osrm.org/route/v1/cycling/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=polyline`;
  
  console.log('Fetching route from OSRM:', url);

  const response = await fetch(url, {
    ...options,
    // Add User-Agent to improve rate limit compliance
    headers: {
      'User-Agent': 'BayWheelin/1.0 (Route analysis tool)',
      ...options.headers,
    },
  });

  return response;
}

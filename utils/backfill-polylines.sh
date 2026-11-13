#!/bin/bash

set -e

# Cloudflare API config

# pretend theres API and account id here

D1_DATABASE_ID="1a853d41-9f8f-4963-a9f8-6d327e2831ee"
KV_NAMESPACE_ID="4ba5cf8ffada4206a7a0a26843b0b524"

D1_API="https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query"
KV_API="https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/bulk"

AUTH_HEADER="Authorization: Bearer ${CF_API_KEY}"
CONTENT_TYPE="Content-Type: application/json"

AMOUNT=${1:-500}

echo "=== Fetching $AMOUNT rides without polylines from rides_202601 ==="

QUERY_BODY=$(jq -n --arg sql "SELECT ride_id, start_lat, start_lng, end_lat, end_lng, start_station_id, end_station_id FROM rides_202601 WHERE route_polyline IS NULL AND start_station_id IS NOT NULL AND end_station_id IS NOT NULL AND start_lat IS NOT NULL AND end_lat IS NOT NULL LIMIT $AMOUNT" '{sql: $sql}')

echo "  POST $D1_API"
echo "  Body: $QUERY_BODY"
HTTP_CODE=$(curl -s -o /tmp/d1_query_resp.json -w "%{http_code}" -X POST "$D1_API" \
  -H "$AUTH_HEADER" \
  -H "$CONTENT_TYPE" \
  -d "$QUERY_BODY")
QUERY_RESPONSE=$(cat /tmp/d1_query_resp.json)
echo "  HTTP $HTTP_CODE"
echo "  Response: $(echo "$QUERY_RESPONSE" | jq -c .)"

# Check for errors
if ! echo "$QUERY_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
  echo "ERROR: D1 query failed:"
  echo "$QUERY_RESPONSE" | jq .
  exit 1
fi

RIDES=$(echo "$QUERY_RESPONSE" | jq -c '.result[0].results // []')
RIDE_COUNT=$(echo "$RIDES" | jq 'length')

echo "Found $RIDE_COUNT rides to process"

if [ "$RIDE_COUNT" -eq 0 ]; then
  echo "No rides to process. Done!"
  exit 0
fi

# Arrays to collect bulk operations
D1_UPDATES=()   # SQL statements for D1 bulk update
KV_ENTRIES=()   # KV bulk put entries
declare -A KV_SEEN  # Track seen KV keys to avoid duplicates
PROCESSED=0
FAILED=0

# Load local cache if it exists
SCRIPT_DIR="$(dirname "$0")"
KV_CACHE="$SCRIPT_DIR/kv.csv"
if [ -f "$KV_CACHE" ]; then
  echo "=== Loading local cache from kv.csv ==="
  while IFS=',' read -r key polyline; do
    KV_SEEN["$key"]="$polyline"
  done < "$KV_CACHE"
  # Rewrite deduped
  > "$KV_CACHE"
  for key in "${!KV_SEEN[@]}"; do
    echo "${key},${KV_SEEN[$key]}" >> "$KV_CACHE"
  done
  echo "  Loaded ${#KV_SEEN[@]} cached routes"
fi

echo "=== Fetching routes from OSRM ==="

for i in $(seq 0 $((RIDE_COUNT - 1))); do
  RIDE=$(echo "$RIDES" | jq -c ".[$i]")
  RIDE_ID=$(echo "$RIDE" | jq -r '.ride_id')
  START_LAT=$(echo "$RIDE" | jq -r '.start_lat')
  START_LNG=$(echo "$RIDE" | jq -r '.start_lng')
  END_LAT=$(echo "$RIDE" | jq -r '.end_lat')
  END_LNG=$(echo "$RIDE" | jq -r '.end_lng')
  START_STATION=$(echo "$RIDE" | jq -r '.start_station_id')
  END_STATION=$(echo "$RIDE" | jq -r '.end_station_id')

  KV_KEY="route:${START_STATION}:${END_STATION}"

  # Reuse cached geometry if we already fetched this station pair
  if [ -n "${KV_SEEN[$KV_KEY]+x}" ]; then
    GEOMETRY="${KV_SEEN[$KV_KEY]}"
    echo "  [$((i+1))/$RIDE_COUNT] CACHED - ride $RIDE_ID ($START_STATION -> $END_STATION)"
  else
    # OSRM expects lon,lat order
    OSRM_URL="https://router.project-osrm.org/route/v1/cycling/${START_LNG},${START_LAT};${END_LNG},${END_LAT}?overview=full&geometries=polyline"

    echo "  [$((i+1))/$RIDE_COUNT] GET $OSRM_URL"
    OSRM_HTTP=$(curl -s -o /tmp/osrm_resp.json -w "%{http_code}" "$OSRM_URL")
    OSRM_RESPONSE=$(cat /tmp/osrm_resp.json)
    echo "  [$((i+1))/$RIDE_COUNT] HTTP $OSRM_HTTP"
    echo "  [$((i+1))/$RIDE_COUNT] Response: $(echo "$OSRM_RESPONSE" | jq -c .)"
    GEOMETRY=$(echo "$OSRM_RESPONSE" | jq -r '.routes[0].geometry // empty')

    if [ -z "$GEOMETRY" ]; then
      echo "  [$((i+1))/$RIDE_COUNT] FAILED - No route for ride $RIDE_ID"
      FAILED=$((FAILED + 1))
      continue
    fi

    # Cache the geometry and collect KV entry
    KV_SEEN[$KV_KEY]="$GEOMETRY"
    echo "${KV_KEY},${GEOMETRY}" >> "$KV_CACHE"
    KV_ENTRY=$(jq -n --arg key "$KV_KEY" --arg value "$GEOMETRY" \
      '{key: $key, value: $value}')
    KV_ENTRIES+=("$KV_ENTRY")

    echo "  [$((i+1))/$RIDE_COUNT] OK - ride $RIDE_ID ($START_STATION -> $END_STATION)"

    # Rate limit: OSRM is a free service, be polite
    sleep 0.1
  fi

  # Collect D1 update (geometry will be passed as a param to avoid escaping issues)
  D1_UPDATES+=("${RIDE_ID}|${GEOMETRY}")

  PROCESSED=$((PROCESSED + 1))
done

echo ""
echo "=== Routing complete: $PROCESSED succeeded, $FAILED failed ==="

if [ "$PROCESSED" -eq 0 ]; then
  echo "No routes to save. Done!"
  exit 0
fi

# --- Bulk update D1 ---
echo "=== Bulk updating D1 ($PROCESSED rides) ==="

# D1 /query supports batch via {batch: [{sql: "..."}, ...]}
# Send in batches of 50 to stay within limits
BATCH_SIZE=50
TOTAL_UPDATES=${#D1_UPDATES[@]}

for ((start=0; start<TOTAL_UPDATES; start+=BATCH_SIZE)); do
  end=$((start + BATCH_SIZE))
  if [ "$end" -gt "$TOTAL_UPDATES" ]; then
    end=$TOTAL_UPDATES
  fi

  # Build batch array using jq with parameterized queries
  BATCH_JSON="[]"
  for ((j=start; j<end; j++)); do
    RIDE_ID="${D1_UPDATES[$j]%%|*}"
    POLYLINE="${D1_UPDATES[$j]#*|}"
    BATCH_JSON=$(echo "$BATCH_JSON" | jq \
      --arg sql "UPDATE rides_202601 SET route_polyline = ? WHERE ride_id = ?" \
      --arg polyline "$POLYLINE" \
      --arg rid "$RIDE_ID" \
      '. + [{sql: $sql, params: [$polyline, $rid]}]')
  done
  SQL_BODY=$(jq -n --argjson batch "$BATCH_JSON" '{batch: $batch}')

  echo "  D1 batch $((start/BATCH_SIZE + 1)): POST $D1_API"
  echo "  D1 batch $((start/BATCH_SIZE + 1)): Body: $(echo "$SQL_BODY" | jq -c .)"
  D1_HTTP=$(curl -s -o /tmp/d1_batch_resp.json -w "%{http_code}" -X POST "$D1_API" \
    -H "$AUTH_HEADER" \
    -H "$CONTENT_TYPE" \
    -d "$SQL_BODY")
  D1_RESULT=$(cat /tmp/d1_batch_resp.json)
  echo "  D1 batch $((start/BATCH_SIZE + 1)): HTTP $D1_HTTP"
  echo "  D1 batch $((start/BATCH_SIZE + 1)): Response: $(echo "$D1_RESULT" | jq -c .)"

  if echo "$D1_RESULT" | jq -e '.success' > /dev/null 2>&1; then
    echo "  D1 batch $((start/BATCH_SIZE + 1)): OK (rows $((start+1))-$end)"
  else
    echo "  D1 batch $((start/BATCH_SIZE + 1)): FAILED"
    echo "$D1_RESULT" | jq .
  fi
done

# --- Bulk put KV ---
echo "=== Bulk putting KV (${#KV_ENTRIES[@]} entries) ==="

# KV bulk write accepts up to 10,000 entries per request
# Send in batches of 100 to be safe
KV_BATCH_SIZE=100
TOTAL_KV=${#KV_ENTRIES[@]}

for ((start=0; start<TOTAL_KV; start+=KV_BATCH_SIZE)); do
  end=$((start + KV_BATCH_SIZE))
  if [ "$end" -gt "$TOTAL_KV" ]; then
    end=$TOTAL_KV
  fi

  KV_BATCH="["
  for ((j=start; j<end; j++)); do
    if [ "$j" -gt "$start" ]; then
      KV_BATCH+=","
    fi
    KV_BATCH+="${KV_ENTRIES[$j]}"
  done
  KV_BATCH+="]"

  echo "  KV batch $((start/KV_BATCH_SIZE + 1)): PUT $KV_API"
  echo "  KV batch $((start/KV_BATCH_SIZE + 1)): Body: $(echo "$KV_BATCH" | jq -c .)"
  KV_HTTP=$(curl -s -o /tmp/kv_batch_resp.json -w "%{http_code}" -X PUT "$KV_API" \
    -H "$AUTH_HEADER" \
    -H "$CONTENT_TYPE" \
    -d "$KV_BATCH")
  KV_RESULT=$(cat /tmp/kv_batch_resp.json)
  echo "  KV batch $((start/KV_BATCH_SIZE + 1)): HTTP $KV_HTTP"
  echo "  KV batch $((start/KV_BATCH_SIZE + 1)): Response: $(echo "$KV_RESULT" | jq -c .)"

  if echo "$KV_RESULT" | jq -e '.success' > /dev/null 2>&1; then
    echo "  KV batch $((start/KV_BATCH_SIZE + 1)): OK (entries $((start+1))-$end)"
  else
    echo "  KV batch $((start/KV_BATCH_SIZE + 1)): FAILED"
    echo "$KV_RESULT" | jq .
  fi
done

echo ""
echo "=== Done! Processed $PROCESSED rides, failed $FAILED ==="

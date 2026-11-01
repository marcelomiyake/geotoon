#!/usr/bin/env bash
# G2 proof against a running GeoToon: the first request for an area may fetch Overture data,
# the second must be served from PostGIS with no new source fetch.
# Usage: scripts/verify-cache.sh [base-url] [lat] [lon]
set -euo pipefail

BASE_URL=${1:-http://localhost:8080}
LAT=${2:--23.561496}
LON=${3:--46.655968}
BODY="{\"lat\":${LAT},\"lon\":${LON}}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

post() {
  curl -sS -o "$TMP/body.json" -w '%{http_code}' -X POST "$BASE_URL/api/v1/areas" \
    -H 'content-type: application/json' -d "$BODY"
}

field() {
  local path="$1"
  node -e 'const b = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const v = process.argv[2].split(".").reduce((o, k) => o?.[k], b); console.log(typeof v === "object" ? JSON.stringify(v) : v);' "$TMP/body.json" "$path"
}

echo "1. First request for ${LAT}, ${LON}"
started=$(date +%s)
code=$(post)
echo "   HTTP ${code}, status $(field status), sourceCalls $(field sourceCalls), tiles $(field tiles.length)"
while [[ "$code" == "202" ]]; do
  sleep 2
  code=$(post)
  if (( $(date +%s) - started > 300 )); then
    echo "FAIL: area not ready after 300 s" >&2
    exit 1
  fi
done
if [[ "$code" != "200" ]]; then
  echo "FAIL: expected 200, got ${code}: $(cat "$TMP/body.json")" >&2
  exit 1
fi
echo "   ready after $(( $(date +%s) - started )) s with $(field scene.buildings.length) buildings"

echo "2. Second request for the same area"
code=$(post)
calls=$(field sourceCalls)
status=$(field status)
incomplete=$(node -e 'const b = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(b.tiles.filter((t) => t.state !== "complete").length);' "$TMP/body.json")
echo "   HTTP ${code}, status ${status}, sourceCalls ${calls}, incomplete tiles ${incomplete}"
if [[ "$code" != "200" || "$status" != "ready" || "$calls" != "0" || "$incomplete" != "0" ]]; then
  echo "FAIL: the second request did not read only from PostGIS" >&2
  exit 1
fi
echo "PASS: the second request was served from PostGIS (sourceCalls 0, every tile complete)"

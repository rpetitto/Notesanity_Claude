#!/bin/bash
# Run one end-to-end suite against a fresh local server, then stop it.
#
#   npm run build                      # the suites drive the built SPA
#   tests/e2e/run.sh tenancy           # or: ai-designer, print, gradebook, answers, live, share, sso
#
# Each run gets its own empty database and bucket under a temp directory, and
# the server runs with the local-only switches the suites need: the AI and
# Clever/ClassLink stand-ins, and sign-up links handed back in the response
# (all localhost only).
set -u
SUITE=${1:?which suite: tenancy, ai-designer, print, gradebook, answers, live, share or sso}
PORT=${PORT:-8799}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
STATE=$(mktemp -d /tmp/notesanity-e2e-XXXXXX)
SHOTS=${SHOTS:-$STATE/shots}
mkdir -p "$SHOTS"
cd "$ROOT"

npx wrangler dev --port "$PORT" --persist-to "$STATE/db" --var AI_STANDIN:1 --var AUTH_DEV_LINKS:1 --var SSO_STANDIN:1 > "$STATE/server.log" 2>&1 &
SERVER=$!
cleanup() { kill "$SERVER" 2>/dev/null; pkill -f "workerd.*$PORT" 2>/dev/null; case "$STATE" in /tmp/notesanity-e2e-*) rm -rf -- "$STATE" ;; esac; }
trap cleanup EXIT
for _ in $(seq 1 120); do curl -sf "localhost:$PORT/api/status" > /dev/null && break; sleep 1; done

URL="http://localhost:$PORT"
PDF="tests/e2e/fixtures/two-pages.pdf"
case "$SUITE" in
  tenancy)     node tests/e2e/tenancy.mjs "$URL" ;;
  ai-designer) node tests/e2e/ai-designer.mjs "$URL" "$PDF" "$SHOTS" ;;
  print)       node tests/e2e/print.mjs "$URL" "$STATE" "$PDF" "$SHOTS" ;;
  gradebook)   node tests/e2e/gradebook.mjs "$URL" "$PDF" "$SHOTS" ;;
  answers)     node tests/e2e/answers.mjs "$URL" "$PDF" "$SHOTS" ;;
  live)        node tests/e2e/live.mjs "$URL" "$PDF" "$SHOTS" ;;
  share)       node tests/e2e/share.mjs "$URL" "$PDF" "$SHOTS" ;;
  sso)         node tests/e2e/sso.mjs "$URL" "$SHOTS" ;;
  *) echo "unknown suite: $SUITE"; exit 2 ;;
esac

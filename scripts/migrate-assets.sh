#!/usr/bin/env bash
# Move every stored file from Fling to R2.
#
# One object at a time, through a temporary file, because both CLIs work on
# paths rather than streams. Each transfer is verified by size before the
# source is considered copied — a truncated PDF is worse than a missing one,
# since it looks present and fails only when a student opens it.
#
# Re-runnable: R2 puts overwrite by key, so a partial run is fixed by running
# it again.
set -uo pipefail
cd "$(dirname "$0")/.."
. ./.cf-credentials

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# `storage list` prints a table; the key is the first column of indented rows.
mapfile -t KEYS < <(npx fling --cli --prod storage list 2>/dev/null \
  | grep -oE '^  [^ ]+' | sed 's/^  //')

echo "found ${#KEYS[@]} objects"
ok=0; bad=0

for key in "${KEYS[@]}"; do
  file="$TMP/obj"
  rm -f "$file"

  if ! npx fling --cli --prod storage get "$key" "$file" >/dev/null 2>&1; then
    echo "  FAIL download  $key"; bad=$((bad+1)); continue
  fi
  src=$(stat -c%s "$file" 2>/dev/null || echo 0)
  if [ "$src" -eq 0 ]; then
    echo "  FAIL empty     $key"; bad=$((bad+1)); continue
  fi

  if ! npx wrangler r2 object put "notesanity-assets/$key" --file "$file" --remote >/dev/null 2>&1; then
    echo "  FAIL upload    $key"; bad=$((bad+1)); continue
  fi

  printf "  ok %10s bytes  %s\n" "$src" "$key"
  ok=$((ok+1))
done

echo
echo "copied $ok, failed $bad"
[ "$bad" -eq 0 ]

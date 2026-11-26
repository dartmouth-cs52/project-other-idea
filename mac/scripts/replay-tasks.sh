#!/bin/sh
# Runs every Northpine task through Haptic with nobody at the keyboard, and
# says which passed. The Haptic server must be running, with the Northpine
# site in it (docs/mac.md). Each task opens the app, asks, follows the
# pointer, and quits.
#
#   mac/scripts/replay-tasks.sh              all of them
#   mac/scripts/replay-tasks.sh freeze-card  the ones named
#
# HAPTIC_SERVER says where the server is (http://localhost:4000 when unset).
cd "$(dirname "$0")/.." || exit 1
swift build --product Northpine >/dev/null 2>&1 || { echo "Northpine did not build"; exit 1; }
app=.build/debug/Northpine
tasks="$*"
[ -n "$tasks" ] || tasks=$("$app" --tasks | cut -f1)
passed=0
total=0
for task in $tasks; do
  total=$((total + 1))
  # Two minutes is far more than any of them needs. A guide that hangs is a failure, not a wait.
  out=$(HAPTIC_TASK="$task" perl -e 'alarm 120; exec @ARGV' "$app" 2>/dev/null)
  line=$(printf '%s\n' "$out" | grep '^TASK ' | tail -1)
  [ -n "$line" ] || line="TASK $task FAIL outcome=no_answer steps=$(printf '%s\n' "$out" | grep -c '^STEP ')"
  echo "$line"
  [ -n "$VERBOSE" ] && printf '%s\n' "$out" | grep '^STEP ' | sed 's/^/    /'
  case "$line" in *" PASS "*) passed=$((passed + 1)) ;; esac
done
echo "$passed of $total passed"
[ "$passed" -eq "$total" ]

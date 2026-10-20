#!/bin/sh
# Starts a fresh local harness for each browser suite, runs it, stops it. Usage: sh tests/e2e/run.sh
cd "$(dirname "$0")/../.."
CODE=0
for SUITE in run_shop.py run_orders.py; do
  PORT=4321 node tests/e2e/server.mjs >/tmp/e2e.log 2>&1 &
  SRV=$!; sleep 1.5
  echo "=== $SUITE ==="; python3 tests/e2e/$SUITE || CODE=1
  kill $SRV 2>/dev/null; wait $SRV 2>/dev/null
done
exit $CODE

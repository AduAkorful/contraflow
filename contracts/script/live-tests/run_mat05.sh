#!/usr/bin/env bash
# plans/03-live-testnet-e2e-tests.md §4 MAT-05 — the one case a local Foundry test structurally
# cannot honestly exercise: real elapsed wall-clock time on Arc testnet, not vm.warp.
set -u
cd "$(dirname "$0")/../.."
set -a; source .env; set +a
source script/live-tests/lib.sh

echo "=== MAT-05 (real wall-clock wait) — $(date -u) ===" | tee -a "$RESULTS_LOG"

NOW=$(now_ts)
MATURITY=$((NOW+80))

A_PK=$(pk_of MAT05-A); B_PK=$(pk_of MAT05-B); C_PK=$(pk_of MAT05-C)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK"); C=$(addr_of "$C_PK")
do_register "$DEPLOYER_PK" "MAT05-AB" 1000000 "$MATURITY" 0 "$A_PK" "$B_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "MAT05-BC" 1000000 "$MATURITY" 0 "$B_PK" "$C_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "MAT05-CA" 1000000 "$MATURITY" 0 "$C_PK" "$A_PK" 1 >/dev/null
ID1=$(invoice_id "MAT05-AB" 1000000 "$MATURITY" 0 "$A" "$B" 1)
ID2=$(invoice_id "MAT05-BC" 1000000 "$MATURITY" 0 "$B" "$C" 1)
ID3=$(invoice_id "MAT05-CA" 1000000 "$MATURITY" 0 "$C" "$A" 1)

echo "Registered with maturity=$MATURITY (now=$NOW, +80s). Attempting immediate settle (must fail)." | tee -a "$RESULTS_LOG"
OUT=$(do_settle "$DEPLOYER_PK" "$ID1" "$ID2" "$ID3" -- 100000); CODE=$?
assert_revert MAT-05a "immediate settle attempt before real maturity elapses" "$OUT" "$CODE" "InvoiceNotNettable"

echo "Polling real chain time until it passes $MATURITY..." | tee -a "$RESULTS_LOG"
until [ "$(now_ts)" -ge "$MATURITY" ]; do
  echo "  ...still waiting, current=$(now_ts), target=$MATURITY" | tee -a "$RESULTS_LOG"
  sleep 8
done
echo "Real time has now passed maturity ($(now_ts) >= $MATURITY). Retrying settle." | tee -a "$RESULTS_LOG"

OUT=$(do_settle "$DEPLOYER_PK" "$ID1" "$ID2" "$ID3" -- 100000); CODE=$?
assert_success MAT-05 "retry settle after real wall-clock time passed maturity -- the one case vm.warp cannot honestly prove" "$OUT" "$CODE"

echo "=== MAT-05 done ===" | tee -a "$RESULTS_LOG"

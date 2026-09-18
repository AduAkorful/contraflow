#!/usr/bin/env bash
# plans/03-live-testnet-e2e-tests.md §7 — RACE-03, RACE-04, RACE-05.
set -u
cd "$(dirname "$0")/../.."
set -a; source .env; set +a
source script/live-tests/lib.sh

echo "=== §7 Race conditions part 2 (RACE-03,04,05) — $(date -u) ===" | tee -a "$RESULTS_LOG"

RELAYER2_PK=$(pk_of relayer2)
NOW=$(now_ts); MAT=$((NOW+2592000))

# ---- RACE-03: concurrent overlapping settle() sharing one invoice ----
P_PK=$(pk_of RACE03-P); Q_PK=$(pk_of RACE03-Q); R_PK=$(pk_of RACE03-R); S_PK=$(pk_of RACE03-S)
P=$(addr_of "$P_PK"); Q=$(addr_of "$Q_PK"); R=$(addr_of "$R_PK"); S=$(addr_of "$S_PK")
do_register "$DEPLOYER_PK" "RACE03-PQ" 2000000 "$MAT" 1 "$P_PK" "$Q_PK" 1 >/dev/null   # shared invoice X
do_register "$DEPLOYER_PK" "RACE03-QR" 2000000 "$MAT" 1 "$Q_PK" "$R_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "RACE03-RP" 2000000 "$MAT" 1 "$R_PK" "$P_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "RACE03-QS" 2000000 "$MAT" 1 "$Q_PK" "$S_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "RACE03-SP" 2000000 "$MAT" 1 "$S_PK" "$P_PK" 1 >/dev/null
ID_X=$(invoice_id "RACE03-PQ" 2000000 "$MAT" 1 "$P" "$Q" 1)
ID_QR=$(invoice_id "RACE03-QR" 2000000 "$MAT" 1 "$Q" "$R" 1)
ID_RP=$(invoice_id "RACE03-RP" 2000000 "$MAT" 1 "$R" "$P" 1)
ID_QS=$(invoice_id "RACE03-QS" 2000000 "$MAT" 1 "$Q" "$S" 1)
ID_SP=$(invoice_id "RACE03-SP" 2000000 "$MAT" 1 "$S" "$P" 1)

# Cycle1 nets X down to 500,000 remaining; Cycle2 then demands 1,000,000 from X -- guaranteed to
# exceed whichever remaining X has left once ONE of the two cycles lands first.
ARR1="[$ID_X,$ID_QR,$ID_RP]"
ARR2="[$ID_X,$ID_QS,$ID_SP]"
cast send "$SETTLER" "settle(bytes32[],uint256)" "$ARR1" 1500000 --private-key "$DEPLOYER_PK" --rpc-url "$ARC_TESTNET_RPC" > /tmp/race03_1.out 2>&1 &
PID1=$!
cast send "$SETTLER" "settle(bytes32[],uint256)" "$ARR2" 1000000 --private-key "$RELAYER2_PK" --rpc-url "$ARC_TESTNET_RPC" > /tmp/race03_2.out 2>&1 &
PID2=$!
wait $PID1; wait $PID2

WINS=0
grep -q "status *1 (success)" /tmp/race03_1.out && WINS=$((WINS+1))
grep -q "status *1 (success)" /tmp/race03_2.out && WINS=$((WINS+1))
if [ "$WINS" -eq 1 ]; then
  echo "PASS  RACE-03  exactly one of two concurrent overlapping settle() calls landed (shared invoice X protected from double-spend of its remaining balance)" | tee -a "$RESULTS_LOG"
else
  echo "FAIL  RACE-03  expected exactly 1 winner, got $WINS" | tee -a "$RESULTS_LOG"
  echo "--- cycle1 ---"; cat /tmp/race03_1.out | tail -5
  echo "--- cycle2 ---"; cat /tmp/race03_2.out | tail -5
fi
if grep -q "status *1 (success)" /tmp/race03_1.out; then LOSER=/tmp/race03_2.out; else LOSER=/tmp/race03_1.out; fi
if grep -q "status *0 (failed)" "$LOSER"; then
  echo "PASS  RACE-03b  the loser reverted on-chain cleanly (status 0), not a partial/corrupted state" | tee -a "$RESULTS_LOG"
else
  echo "FAIL  RACE-03b  loser's receipt unexpected:" | tee -a "$RESULTS_LOG"; cat "$LOSER" | tail -8
fi

# ---- RACE-04: front-running / calldata-copy is harmless by design ----
E_PK=$(pk_of RACE04-E); F_PK=$(pk_of RACE04-F); G_PK=$(pk_of RACE04-G)
E=$(addr_of "$E_PK"); F=$(addr_of "$F_PK"); G=$(addr_of "$G_PK")
do_register "$DEPLOYER_PK" "RACE04-EF" 1000000 "$MAT" 1 "$E_PK" "$F_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "RACE04-FG" 1000000 "$MAT" 1 "$F_PK" "$G_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "RACE04-GE" 1000000 "$MAT" 1 "$G_PK" "$E_PK" 1 >/dev/null
ID_EF=$(invoice_id "RACE04-EF" 1000000 "$MAT" 1 "$E" "$F" 1)
ID_FG=$(invoice_id "RACE04-FG" 1000000 "$MAT" 1 "$F" "$G" 1)
ID_GE=$(invoice_id "RACE04-GE" 1000000 "$MAT" 1 "$G" "$E" 1)
ARR="[$ID_EF,$ID_FG,$ID_GE]"

# "Front-runner" (relayer2) copies and submits the exact same call first.
OUT=$(cast send "$SETTLER" "settle(bytes32[],uint256)" "$ARR" 1000000 --private-key "$RELAYER2_PK" --rpc-url "$ARC_TESTNET_RPC" 2>&1); CODE=$?
assert_success RACE-04a "front-runner (relayer2) submits a copy of the settle calldata first" "$OUT" "$CODE"

# "Original legitimate sender" (deployer) now submits the identical call, landing second.
OUT=$(cast send "$SETTLER" "settle(bytes32[],uint256)" "$ARR" 1000000 --private-key "$DEPLOYER_PK" --rpc-url "$ARC_TESTNET_RPC" 2>&1); CODE=$?
assert_revert RACE-04 "original sender's now-redundant identical settle() lands second -- reverts cleanly, no double-net, no exploit from the copy" "$OUT" "$CODE" "InvoiceNotActive\|AmountExceedsRemaining"

# ---- RACE-05: settle() racing an unconfirmed register() ----
H_PK=$(pk_of RACE05-H); I_PK=$(pk_of RACE05-I); J_PK=$(pk_of RACE05-J)
H=$(addr_of "$H_PK"); I=$(addr_of "$I_PK"); J=$(addr_of "$J_PK")
# Pre-register two of the three legs so the only missing piece is H->I (fired concurrently below).
do_register "$DEPLOYER_PK" "RACE05-IJ" 1000000 "$MAT" 1 "$I_PK" "$J_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "RACE05-JH" 1000000 "$MAT" 1 "$J_PK" "$H_PK" 1 >/dev/null
ID_IJ=$(invoice_id "RACE05-IJ" 1000000 "$MAT" 1 "$I" "$J" 1)
ID_JH=$(invoice_id "RACE05-JH" 1000000 "$MAT" 1 "$J" "$H" 1)
ID_HI=$(invoice_id "RACE05-HI" 1000000 "$MAT" 1 "$H" "$I" 1)  # not registered yet
ARR="[$ID_HI,$ID_IJ,$ID_JH]"

JSON_HI=$(build_invoice_json "RACE05-HI" 1000000 "$MAT" true "$H" "$I" 1)
DSIG_HI=$(sign_json "$H_PK" "$JSON_HI"); CSIG_HI=$(sign_json "$I_PK" "$JSON_HI")
REF_HI=$(cast keccak "RACE05-HI")

# Fire register(H->I) via relayer2 and settle([HI,IJ,JH]) via deployer concurrently, no wait --
# settle references an id that may or may not exist yet at the moment it actually executes.
cast send "$REGISTRY" "register((bytes32,uint256,address,uint64,bool,address,address,uint256,address,uint256),bytes,bytes)" \
  "($REF_HI,1000000,$USDC,$MAT,true,$H,$I,1,$REGISTRY,$CHAINID)" "$DSIG_HI" "$CSIG_HI" \
  --private-key "$RELAYER2_PK" --rpc-url "$ARC_TESTNET_RPC" > /tmp/race05_reg.out 2>&1 &
PID_REG=$!
cast send "$SETTLER" "settle(bytes32[],uint256)" "$ARR" 500000 --private-key "$DEPLOYER_PK" --rpc-url "$ARC_TESTNET_RPC" > /tmp/race05_settle.out 2>&1 &
PID_SETTLE=$!
wait $PID_REG; wait $PID_SETTLE

echo "  RACE-05 register: $(grep 'status' /tmp/race05_reg.out)   settle: $(grep 'status' /tmp/race05_settle.out)" | tee -a "$RESULTS_LOG"
if grep -q "status *1 (success)" /tmp/race05_reg.out; then
  echo "PASS  RACE-05a  register(H->I) succeeded" | tee -a "$RESULTS_LOG"
else
  echo "FAIL  RACE-05a  register(H->I) unexpectedly failed:" | tee -a "$RESULTS_LOG"; cat /tmp/race05_reg.out | tail -5
fi
if grep -q "status *0 (failed)" /tmp/race05_settle.out; then
  echo "PASS  RACE-05b  settle() referencing the concurrently-registering invoice reverted (no unsafe optimistic read of pending state)" | tee -a "$RESULTS_LOG"
  # Follow-up: now that H->I is confirmed, the identical settle() should succeed.
  OUT=$(do_settle "$DEPLOYER_PK" "$ID_HI" "$ID_IJ" "$ID_JH" -- 500000); CODE=$?
  assert_success RACE-05 "resubmitted settle() after register(H->I) confirmed -- succeeds once the dependency is real" "$OUT" "$CODE"
elif grep -q "status *1 (success)" /tmp/race05_settle.out; then
  echo "NOTE  RACE-05b  settle() succeeded -- network happened to confirm register(H->I) first despite concurrent submission; not a failure, just non-adversarial ordering this run" | tee -a "$RESULTS_LOG"
  echo "PASS  RACE-05  (settle succeeded directly; register had already landed first)" | tee -a "$RESULTS_LOG"
else
  echo "FAIL  RACE-05b  settle() failed for an unexpected reason:" | tee -a "$RESULTS_LOG"; cat /tmp/race05_settle.out | tail -8
fi

echo "=== §7 part 2 done ===" | tee -a "$RESULTS_LOG"

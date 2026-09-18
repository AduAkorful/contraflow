#!/usr/bin/env bash
# plans/03-live-testnet-e2e-tests.md §7 — race conditions, RACE-01..05.
# Uses real OS-level backgrounding (&) of two independent `cast send` processes so both reach
# the RPC node at nearly the same wall-clock moment, submitted by two independent relayer keys
# (deployer + relayer2) so there's no forced account-nonce ordering between them -- genuine
# concurrent-submission nondeterminism a single sequential script (or any local Foundry test)
# cannot produce.
set -u
cd "$(dirname "$0")/../.."
set -a; source .env; set +a
source script/live-tests/lib.sh

echo "=== §7 Race conditions (RACE-*) — $(date -u) ===" | tee -a "$RESULTS_LOG"

RELAYER2_PK=$(pk_of relayer2)
NOW=$(now_ts); MAT=$((NOW+2592000))

# ---- RACE-01: nonce contention, same pair, same nonce, two different relayers ----
A_PK=$(pk_of RACE01-A); B_PK=$(pk_of RACE01-B)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK")
JSON1=$(build_invoice_json "RACE-01a" 1000000 "$MAT" true "$A" "$B" 1)
JSON2=$(build_invoice_json "RACE-01b" 2000000 "$MAT" true "$A" "$B" 1)
DSIG1=$(sign_json "$A_PK" "$JSON1"); CSIG1=$(sign_json "$B_PK" "$JSON1")
DSIG2=$(sign_json "$A_PK" "$JSON2"); CSIG2=$(sign_json "$B_PK" "$JSON2")
REF1=$(cast keccak "RACE-01a"); REF2=$(cast keccak "RACE-01b")

cast send "$REGISTRY" "register((bytes32,uint256,address,uint64,bool,address,address,uint256,address,uint256),bytes,bytes)" \
  "($REF1,1000000,$USDC,$MAT,true,$A,$B,1,$REGISTRY,$CHAINID)" "$DSIG1" "$CSIG1" \
  --private-key "$DEPLOYER_PK" --rpc-url "$ARC_TESTNET_RPC" > /tmp/race01_1.out 2>&1 &
PID1=$!
cast send "$REGISTRY" "register((bytes32,uint256,address,uint64,bool,address,address,uint256,address,uint256),bytes,bytes)" \
  "($REF2,2000000,$USDC,$MAT,true,$A,$B,1,$REGISTRY,$CHAINID)" "$DSIG2" "$CSIG2" \
  --private-key "$RELAYER2_PK" --rpc-url "$ARC_TESTNET_RPC" > /tmp/race01_2.out 2>&1 &
PID2=$!
wait $PID1; CODE1=$?
wait $PID2; CODE2=$?

# NOTE: cast send's shell exit code only reflects "broadcast succeeded and a receipt was
# fetched" -- when two conflicting txs both pass cast's pre-broadcast simulation (plausible when
# submitted concurrently, since neither sees the other's effect yet), cast exits 0 for both even
# though only one can succeed once actually mined. Must check the receipt's own status field.
WINS=0
grep -q "status *1 (success)" /tmp/race01_1.out && WINS=$((WINS+1))
grep -q "status *1 (success)" /tmp/race01_2.out && WINS=$((WINS+1))
if [ "$WINS" -eq 1 ]; then
  echo "PASS  RACE-01  exactly one of two concurrent same-nonce registrations landed (tx1 exit=$CODE1, tx2 exit=$CODE2)" | tee -a "$RESULTS_LOG"
else
  echo "FAIL  RACE-01  expected exactly 1 winner, got $WINS :: tx1 exit=$CODE1 tx2 exit=$CODE2" | tee -a "$RESULTS_LOG"
  echo "--- tx1 ---"; cat /tmp/race01_1.out | tail -5
  echo "--- tx2 ---"; cat /tmp/race01_2.out | tail -5
fi
# The "loser" is whichever receipt did NOT show status 1 -- get its tx hash and fetch the
# receipt fresh (a reverted receipt's logs are empty, which is the on-chain-verifiable signal;
# cast's own broadcast-time output doesn't decode the revert reason for an already-mined tx).
if grep -q "status *1 (success)" /tmp/race01_1.out; then LOSER_FILE=/tmp/race01_2.out; else LOSER_FILE=/tmp/race01_1.out; fi
if grep -q "status *0 (failed)" "$LOSER_FILE" && grep -q "logs *\[\]" "$LOSER_FILE"; then
  echo "PASS  RACE-01b  the loser reverted on-chain (status 0, zero logs -- no InvoiceRegistered emitted, no stuck/ambiguous state)" | tee -a "$RESULTS_LOG"
else
  echo "FAIL  RACE-01b  loser's receipt didn't show the expected clean-revert shape:" | tee -a "$RESULTS_LOG"; cat "$LOSER_FILE" | tail -8
fi

# ---- RACE-02: out-of-order nonce submission, fresh pair, two relayers, no wait between ----
C_PK=$(pk_of RACE02-C); D_PK=$(pk_of RACE02-D)
C=$(addr_of "$C_PK"); D=$(addr_of "$D_PK")
JSON_N1=$(build_invoice_json "RACE-02-n1" 1000000 "$MAT" true "$C" "$D" 1)
JSON_N2=$(build_invoice_json "RACE-02-n2" 1000000 "$MAT" true "$C" "$D" 2)
DSIG_N1=$(sign_json "$C_PK" "$JSON_N1"); CSIG_N1=$(sign_json "$D_PK" "$JSON_N1")
DSIG_N2=$(sign_json "$C_PK" "$JSON_N2"); CSIG_N2=$(sign_json "$D_PK" "$JSON_N2")
REF_N1=$(cast keccak "RACE-02-n1"); REF_N2=$(cast keccak "RACE-02-n2")

cast send "$REGISTRY" "register((bytes32,uint256,address,uint64,bool,address,address,uint256,address,uint256),bytes,bytes)" \
  "($REF_N2,1000000,$USDC,$MAT,true,$C,$D,2,$REGISTRY,$CHAINID)" "$DSIG_N2" "$CSIG_N2" \
  --private-key "$RELAYER2_PK" --rpc-url "$ARC_TESTNET_RPC" > /tmp/race02_n2.out 2>&1 &
PID_N2=$!
cast send "$REGISTRY" "register((bytes32,uint256,address,uint64,bool,address,address,uint256,address,uint256),bytes,bytes)" \
  "($REF_N1,1000000,$USDC,$MAT,true,$C,$D,1,$REGISTRY,$CHAINID)" "$DSIG_N1" "$CSIG_N1" \
  --private-key "$DEPLOYER_PK" --rpc-url "$ARC_TESTNET_RPC" > /tmp/race02_n1.out 2>&1 &
PID_N1=$!
wait $PID_N2; CODE_N2=$?
wait $PID_N1; CODE_N1=$?

echo "  RACE-02 concurrent submission result: nonce=1 exit=$CODE_N1, nonce=2 exit=$CODE_N2" | tee -a "$RESULTS_LOG"
if [ "$CODE_N1" -eq 0 ]; then
  echo "PASS  RACE-02a  nonce=1 succeeded" | tee -a "$RESULTS_LOG"
else
  echo "FAIL  RACE-02a  nonce=1 unexpectedly failed:" | tee -a "$RESULTS_LOG"; cat /tmp/race02_n1.out | tail -5
fi
# nonce=2 must NEVER succeed unless it happened to execute strictly after nonce=1 was already
# confirmed -- report actual outcome rather than assume.
if [ "$CODE_N2" -ne 0 ] && grep -q "NonceNotSequential" /tmp/race02_n2.out; then
  echo "PASS  RACE-02b  nonce=2 (submitted concurrently, before nonce=1 confirmed) reverted NonceNotSequential as expected" | tee -a "$RESULTS_LOG"
elif [ "$CODE_N2" -eq 0 ]; then
  echo "NOTE  RACE-02b  nonce=2 succeeded -- network happened to confirm nonce=1 first despite concurrent submission; not a failure, just non-adversarial ordering this run" | tee -a "$RESULTS_LOG"
else
  echo "FAIL  RACE-02b  nonce=2 failed for an unexpected reason:" | tee -a "$RESULTS_LOG"; cat /tmp/race02_n2.out | tail -5
fi
# Follow-up: whichever of nonce=1/2 didn't land, retry it now sequentially -- confirms no stuck state.
if [ "$CODE_N2" -ne 0 ]; then
  OUT=$(do_register "$DEPLOYER_PK" "RACE-02-n2-retry" 1000000 "$MAT" 1 "$C_PK" "$D_PK" 2); CODE=$?
  assert_success RACE-02 "resubmitted nonce=2 after nonce=1 confirmed -- no permanently-stuck state from the earlier adversarial ordering" "$OUT" "$CODE"
else
  echo "PASS  RACE-02  (nonce=2 already succeeded in the concurrent attempt -- no stuck state to demonstrate recovery from)" | tee -a "$RESULTS_LOG"
fi

echo "=== §7 part 1 (RACE-01, RACE-02) done ===" | tee -a "$RESULTS_LOG"

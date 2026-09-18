#!/usr/bin/env bash
# plans/03-live-testnet-e2e-tests.md §3 (SET-*) and §8 (BAL-*).
set -u
cd "$(dirname "$0")/../.."
set -a; source .env; set +a
source script/live-tests/lib.sh

echo "=== §3 Settler validation (SET-*) + §8 Balance proof (BAL-*) — $(date -u) ===" | tee -a "$RESULTS_LOG"

RELAYER2_PK=$(pk_of relayer2)
NOW=$(now_ts); MAT=$((NOW+2592000))
usdc_balance() { cast call "$USDC" "balanceOf(address)(uint256)" "$1" --rpc-url "$ARC_TESTNET_RPC"; }

# helper: register a 3-cycle A->B->C->A with equal amounts, all consenting, return nothing
# (invoice ids are recomputed via invoice_id() by callers, deterministic from the same seeds).
reg3() {
  local tag="$1" amt="$2" a_pk="$3" b_pk="$4" c_pk="$5"
  do_register "$DEPLOYER_PK" "$tag-AB" "$amt" "$MAT" 1 "$a_pk" "$b_pk" 1 >/dev/null
  do_register "$DEPLOYER_PK" "$tag-BC" "$amt" "$MAT" 1 "$b_pk" "$c_pk" 1 >/dev/null
  do_register "$DEPLOYER_PK" "$tag-CA" "$amt" "$MAT" 1 "$c_pk" "$a_pk" 1 >/dev/null
}

# ---- SET-01: happy path 3-cycle + BAL-01 + BAL-02 ----
A_PK=$(pk_of SET01-A); B_PK=$(pk_of SET01-B); C_PK=$(pk_of SET01-C)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK"); C=$(addr_of "$C_PK")
reg3 SET01 1000000 "$A_PK" "$B_PK" "$C_PK"
ID_AB=$(invoice_id "SET01-AB" 1000000 "$MAT" 1 "$A" "$B" 1)
ID_BC=$(invoice_id "SET01-BC" 1000000 "$MAT" 1 "$B" "$C" 1)
ID_CA=$(invoice_id "SET01-CA" 1000000 "$MAT" 1 "$C" "$A" 1)

BAL_A_BEFORE=$(usdc_balance "$A"); BAL_B_BEFORE=$(usdc_balance "$B"); BAL_C_BEFORE=$(usdc_balance "$C")
BAL_REG_BEFORE=$(usdc_balance "$REGISTRY"); BAL_SET_BEFORE=$(usdc_balance "$SETTLER")

OUT=$(do_settle "$DEPLOYER_PK" "$ID_AB" "$ID_BC" "$ID_CA" -- 500000); CODE=$?
assert_success SET-01 "happy path 3-cycle settle, called by unrelated relayer" "$OUT" "$CODE"

BAL_A_AFTER=$(usdc_balance "$A"); BAL_B_AFTER=$(usdc_balance "$B"); BAL_C_AFTER=$(usdc_balance "$C")
BAL_REG_AFTER=$(usdc_balance "$REGISTRY"); BAL_SET_AFTER=$(usdc_balance "$SETTLER")

if [ "$BAL_A_BEFORE" = "$BAL_A_AFTER" ] && [ "$BAL_B_BEFORE" = "$BAL_B_AFTER" ] && [ "$BAL_C_BEFORE" = "$BAL_C_AFTER" ]; then
  echo "PASS  BAL-01  all 3 party USDC balances unchanged by settle ($BAL_A_BEFORE/$BAL_B_BEFORE/$BAL_C_BEFORE)" | tee -a "$RESULTS_LOG"
else
  echo "FAIL  BAL-01  party balance changed :: before A=$BAL_A_BEFORE B=$BAL_B_BEFORE C=$BAL_C_BEFORE / after A=$BAL_A_AFTER B=$BAL_B_AFTER C=$BAL_C_AFTER" | tee -a "$RESULTS_LOG"
fi
if [ "$BAL_REG_BEFORE" = "0" ] && [ "$BAL_REG_AFTER" = "0" ] && [ "$BAL_SET_BEFORE" = "0" ] && [ "$BAL_SET_AFTER" = "0" ]; then
  echo "PASS  BAL-02  Registry and Settler hold zero USDC before and after" | tee -a "$RESULTS_LOG"
else
  echo "FAIL  BAL-02  contract holds nonzero USDC :: reg before=$BAL_REG_BEFORE after=$BAL_REG_AFTER, settler before=$BAL_SET_BEFORE after=$BAL_SET_AFTER" | tee -a "$RESULTS_LOG"
fi

# getInvoice cross-check: each amountRemaining should now be 500000
for pair in "$ID_AB:AB" "$ID_BC:BC" "$ID_CA:CA"; do
  id="${pair%%:*}"; label="${pair##*:}"
  remaining=$(cast call "$REGISTRY" "getInvoice(bytes32)((address,uint64,bool,uint8,address,uint256,uint256))" "$id" --rpc-url "$ARC_TESTNET_RPC" | sed -E 's/.*, ([0-9]+) \[.*\], ([0-9]+)\)/\1/')
  echo "  SET-01 post-check $label amountRemaining (should be 500000): $remaining" | tee -a "$RESULTS_LOG"
done

# ---- SET-02: 4-cycle ----
A_PK=$(pk_of SET02-A); B_PK=$(pk_of SET02-B); C_PK=$(pk_of SET02-C); D_PK=$(pk_of SET02-D)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK"); C=$(addr_of "$C_PK"); D=$(addr_of "$D_PK")
do_register "$DEPLOYER_PK" "SET02-AB" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "SET02-BC" 1000000 "$MAT" 1 "$B_PK" "$C_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "SET02-CD" 1000000 "$MAT" 1 "$C_PK" "$D_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "SET02-DA" 1000000 "$MAT" 1 "$D_PK" "$A_PK" 1 >/dev/null
ID1=$(invoice_id "SET02-AB" 1000000 "$MAT" 1 "$A" "$B" 1)
ID2=$(invoice_id "SET02-BC" 1000000 "$MAT" 1 "$B" "$C" 1)
ID3=$(invoice_id "SET02-CD" 1000000 "$MAT" 1 "$C" "$D" 1)
ID4=$(invoice_id "SET02-DA" 1000000 "$MAT" 1 "$D" "$A" 1)
OUT=$(do_settle "$DEPLOYER_PK" "$ID1" "$ID2" "$ID3" "$ID4" -- 500000); CODE=$?
assert_success SET-02 "happy path 4-cycle" "$OUT" "$CODE"

# ---- SET-03: 5-cycle (max) ----
A_PK=$(pk_of SET03-A); B_PK=$(pk_of SET03-B); C_PK=$(pk_of SET03-C); D_PK=$(pk_of SET03-D); E_PK=$(pk_of SET03-E)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK"); C=$(addr_of "$C_PK"); D=$(addr_of "$D_PK"); E=$(addr_of "$E_PK")
do_register "$DEPLOYER_PK" "SET03-AB" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "SET03-BC" 1000000 "$MAT" 1 "$B_PK" "$C_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "SET03-CD" 1000000 "$MAT" 1 "$C_PK" "$D_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "SET03-DE" 1000000 "$MAT" 1 "$D_PK" "$E_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "SET03-EA" 1000000 "$MAT" 1 "$E_PK" "$A_PK" 1 >/dev/null
ID1=$(invoice_id "SET03-AB" 1000000 "$MAT" 1 "$A" "$B" 1)
ID2=$(invoice_id "SET03-BC" 1000000 "$MAT" 1 "$B" "$C" 1)
ID3=$(invoice_id "SET03-CD" 1000000 "$MAT" 1 "$C" "$D" 1)
ID4=$(invoice_id "SET03-DE" 1000000 "$MAT" 1 "$D" "$E" 1)
ID5=$(invoice_id "SET03-EA" 1000000 "$MAT" 1 "$E" "$A" 1)
OUT=$(do_settle "$DEPLOYER_PK" "$ID1" "$ID2" "$ID3" "$ID4" "$ID5" -- 500000); CODE=$?
assert_success SET-03 "happy path 5-cycle (max length)" "$OUT" "$CODE"

# ---- SET-04/05/06: cycle length bounds (reuse SET-01's already-settled ids, length check is first) ----
OUT=$(do_settle "$DEPLOYER_PK" "$ID_AB" "$ID_BC" -- 100); CODE=$?
assert_revert SET-04 "cycle length 2" "$OUT" "$CODE" "CycleLengthInvalid"
OUT=$(do_settle "$DEPLOYER_PK" "$ID_AB" "$ID_BC" "$ID_CA" "$ID_AB" "$ID_BC" "$ID_CA" -- 100); CODE=$?
assert_revert SET-05 "cycle length 6" "$OUT" "$CODE" "CycleLengthInvalid"
OUT=$(cast send "$SETTLER" "settle(bytes32[],uint256)" "[]" 100 --private-key "$DEPLOYER_PK" --rpc-url "$ARC_TESTNET_RPC" 2>&1); CODE=$?
assert_revert SET-06 "empty cycle" "$OUT" "$CODE" "CycleLengthInvalid"

# ---- SET-07: zero wNet ----
A_PK=$(pk_of SET07-A); B_PK=$(pk_of SET07-B); C_PK=$(pk_of SET07-C)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK"); C=$(addr_of "$C_PK")
reg3 SET07 1000000 "$A_PK" "$B_PK" "$C_PK"
ID1=$(invoice_id "SET07-AB" 1000000 "$MAT" 1 "$A" "$B" 1)
ID2=$(invoice_id "SET07-BC" 1000000 "$MAT" 1 "$B" "$C" 1)
ID3=$(invoice_id "SET07-CA" 1000000 "$MAT" 1 "$C" "$A" 1)
OUT=$(do_settle "$DEPLOYER_PK" "$ID1" "$ID2" "$ID3" -- 0); CODE=$?
assert_revert SET-07 "zero wNet" "$OUT" "$CODE" "ZeroWNet"

# ---- SET-08: duplicate id in array ----
OUT=$(do_settle "$DEPLOYER_PK" "$ID1" "$ID2" "$ID1" -- 100); CODE=$?
assert_revert SET-08 "duplicate id in cycle array" "$OUT" "$CODE" "DuplicateInvoiceId"

# ---- SET-09: broken path, unrelated invoices ----
A_PK=$(pk_of SET09-A); B_PK=$(pk_of SET09-B); C_PK=$(pk_of SET09-C); D_PK=$(pk_of SET09-D); E_PK=$(pk_of SET09-E); F_PK=$(pk_of SET09-F)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK"); C=$(addr_of "$C_PK"); D=$(addr_of "$D_PK"); E=$(addr_of "$E_PK"); F=$(addr_of "$F_PK")
do_register "$DEPLOYER_PK" "SET09-AB" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "SET09-CD" 1000000 "$MAT" 1 "$C_PK" "$D_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "SET09-EF" 1000000 "$MAT" 1 "$E_PK" "$F_PK" 1 >/dev/null
ID1=$(invoice_id "SET09-AB" 1000000 "$MAT" 1 "$A" "$B" 1)
ID2=$(invoice_id "SET09-CD" 1000000 "$MAT" 1 "$C" "$D" 1)
ID3=$(invoice_id "SET09-EF" 1000000 "$MAT" 1 "$E" "$F" 1)
OUT=$(do_settle "$DEPLOYER_PK" "$ID1" "$ID2" "$ID3" -- 100); CODE=$?
assert_revert SET-09 "broken path, unrelated invoices" "$OUT" "$CODE" "PathBroken"

# ---- SET-10: near-cycle that doesn't close ----
OUT=$(do_settle "$DEPLOYER_PK" "$ID_AB" "$ID2" "$ID3" -- 100); CODE=$?
assert_revert SET-10 "near-cycle, doesn't close back to start" "$OUT" "$CODE" "PathBroken"

# ---- SET-11: wNet exceeds remaining, fresh cycle ----
A_PK=$(pk_of SET11-A); B_PK=$(pk_of SET11-B); C_PK=$(pk_of SET11-C)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK"); C=$(addr_of "$C_PK")
reg3 SET11 1000000 "$A_PK" "$B_PK" "$C_PK"
ID1=$(invoice_id "SET11-AB" 1000000 "$MAT" 1 "$A" "$B" 1)
ID2=$(invoice_id "SET11-BC" 1000000 "$MAT" 1 "$B" "$C" 1)
ID3=$(invoice_id "SET11-CA" 1000000 "$MAT" 1 "$C" "$A" 1)
OUT=$(do_settle "$DEPLOYER_PK" "$ID1" "$ID2" "$ID3" -- 2000000); CODE=$?
assert_revert SET-11 "wNet exceeds remaining, first settle ever, whole-tx-revert (no partial cancel)" "$OUT" "$CODE" "AmountExceedsRemaining"

# ---- SET-12: wNet exceeds remaining, second settle on SET-01's already-reduced cycle ----
OUT=$(do_settle "$DEPLOYER_PK" "$ID_AB" "$ID_BC" "$ID_CA" -- 600000); CODE=$?
assert_revert SET-12 "wNet(600k) exceeds SET-01's post-settle remaining(500k) -- spec 11 item 3" "$OUT" "$CODE" "AmountExceedsRemaining"

# ---- SET-13/14: non-nettable invoice blocks only its own cycle ----
A_PK=$(pk_of SET13-A); B_PK=$(pk_of SET13-B); C_PK=$(pk_of SET13-C)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK"); C=$(addr_of "$C_PK")
do_register "$DEPLOYER_PK" "SET13-AB" 1000000 "$MAT" 0 "$A_PK" "$B_PK" 1 >/dev/null  # consent=false, future maturity
do_register "$DEPLOYER_PK" "SET13-BC" 1000000 "$MAT" 1 "$B_PK" "$C_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "SET13-CA" 1000000 "$MAT" 1 "$C_PK" "$A_PK" 1 >/dev/null
ID1=$(invoice_id "SET13-AB" 1000000 "$MAT" 0 "$A" "$B" 1)
ID2=$(invoice_id "SET13-BC" 1000000 "$MAT" 1 "$B" "$C" 1)
ID3=$(invoice_id "SET13-CA" 1000000 "$MAT" 1 "$C" "$A" 1)
OUT=$(do_settle "$DEPLOYER_PK" "$ID1" "$ID2" "$ID3" -- 100000); CODE=$?
assert_revert SET-13 "cycle blocked by one non-nettable (not matured, no early consent) invoice" "$OUT" "$CODE" "InvoiceNotNettable"

D_PK=$(pk_of SET14-D); E_PK=$(pk_of SET14-E); F_PK=$(pk_of SET14-F)
D=$(addr_of "$D_PK"); E=$(addr_of "$E_PK"); F=$(addr_of "$F_PK")
reg3 SET14 1000000 "$D_PK" "$E_PK" "$F_PK"
ID4=$(invoice_id "SET14-AB" 1000000 "$MAT" 1 "$D" "$E" 1)
ID5=$(invoice_id "SET14-BC" 1000000 "$MAT" 1 "$E" "$F" 1)
ID6=$(invoice_id "SET14-CA" 1000000 "$MAT" 1 "$F" "$D" 1)
OUT=$(do_settle "$DEPLOYER_PK" "$ID4" "$ID5" "$ID6" -- 100000); CODE=$?
assert_success SET-14 "independent cycle NOT containing SET-13's blocked invoice succeeds" "$OUT" "$CODE"

# ---- SET-15: unregistered invoice id in cycle ----
NEVER_ID=$(cast keccak "SET-15-never-registered")
OUT=$(do_settle "$DEPLOYER_PK" "$ID4" "$ID5" "$NEVER_ID" -- 100); CODE=$?
assert_revert SET-15 "cycle references an unregistered invoice id" "$OUT" "$CODE" "InvoiceNotFound"

# ---- SET-16: non-distinct-party cycle (audit's open product question) ----
A_PK=$(pk_of SET16-A); B_PK=$(pk_of SET16-B)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK")
do_register "$DEPLOYER_PK" "SET16-1" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1 >/dev/null  # A->B
do_register "$DEPLOYER_PK" "SET16-2" 1000000 "$MAT" 1 "$B_PK" "$A_PK" 1 >/dev/null  # B->A
do_register "$DEPLOYER_PK" "SET16-3" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 2 >/dev/null  # A->B (nonce2)
do_register "$DEPLOYER_PK" "SET16-4" 1000000 "$MAT" 1 "$B_PK" "$A_PK" 2 >/dev/null  # B->A (nonce2)
ID1=$(invoice_id "SET16-1" 1000000 "$MAT" 1 "$A" "$B" 1)
ID2=$(invoice_id "SET16-2" 1000000 "$MAT" 1 "$B" "$A" 1)
ID3=$(invoice_id "SET16-3" 1000000 "$MAT" 1 "$A" "$B" 2)
ID4=$(invoice_id "SET16-4" 1000000 "$MAT" 1 "$B" "$A" 2)
OUT=$(do_settle "$DEPLOYER_PK" "$ID1" "$ID2" "$ID3" "$ID4" -- 100000); CODE=$?
assert_success SET-16 "non-distinct-party cycle (A->B->A->B->A across 4 invoices) -- documents current behavior, not a fix demand" "$OUT" "$CODE"

# ---- SET-17/18: full extinguish within a partial cycle, then reuse the extinguished invoice ----
A_PK=$(pk_of SET17-A); B_PK=$(pk_of SET17-B); C_PK=$(pk_of SET17-C)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK"); C=$(addr_of "$C_PK")
do_register "$DEPLOYER_PK" "SET17-AB" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "SET17-BC" 2000000 "$MAT" 1 "$B_PK" "$C_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "SET17-CA" 1000000 "$MAT" 1 "$C_PK" "$A_PK" 1 >/dev/null
ID_AB17=$(invoice_id "SET17-AB" 1000000 "$MAT" 1 "$A" "$B" 1)
ID_BC17=$(invoice_id "SET17-BC" 2000000 "$MAT" 1 "$B" "$C" 1)
ID_CA17=$(invoice_id "SET17-CA" 1000000 "$MAT" 1 "$C" "$A" 1)
OUT=$(do_settle "$DEPLOYER_PK" "$ID_AB17" "$ID_BC17" "$ID_CA17" -- 1000000); CODE=$?
assert_success SET-17 "wNet exactly equals smallest remaining -- full extinguish for 2, partial for 1" "$OUT" "$CODE"
STATUS_AB=$(cast call "$REGISTRY" "getInvoice(bytes32)((address,uint64,bool,uint8,address,uint256,uint256))" "$ID_AB17" --rpc-url "$ARC_TESTNET_RPC")
echo "  SET-17 post-check AB invoice (expect status=1 ExtinguishedOnchain, remaining=0): $STATUS_AB" | tee -a "$RESULTS_LOG"

D_PK=$(pk_of SET18-D); E_PK=$(pk_of SET18-E)
D=$(addr_of "$D_PK"); E=$(addr_of "$E_PK")
do_register "$DEPLOYER_PK" "SET18-DE" 1000000 "$MAT" 1 "$D_PK" "$E_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "SET18-ED" 1000000 "$MAT" 1 "$E_PK" "$D_PK" 1 >/dev/null
ID_DE=$(invoice_id "SET18-DE" 1000000 "$MAT" 1 "$D" "$E" 1)
ID_ED=$(invoice_id "SET18-ED" 1000000 "$MAT" 1 "$E" "$D" 1)
OUT=$(do_settle "$DEPLOYER_PK" "$ID_AB17" "$ID_DE" "$ID_ED" -- 100); CODE=$?
assert_revert SET-18 "reuse an already-extinguished invoice in a new cycle" "$OUT" "$CODE" "InvoiceNotActive"

# ---- SET-19: sequential partial nets accumulate correctly ----
A_PK=$(pk_of SET19-A); B_PK=$(pk_of SET19-B); C_PK=$(pk_of SET19-C)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK"); C=$(addr_of "$C_PK")
reg3 SET19 3000000 "$A_PK" "$B_PK" "$C_PK"
ID1=$(invoice_id "SET19-AB" 3000000 "$MAT" 1 "$A" "$B" 1)
ID2=$(invoice_id "SET19-BC" 3000000 "$MAT" 1 "$B" "$C" 1)
ID3=$(invoice_id "SET19-CA" 3000000 "$MAT" 1 "$C" "$A" 1)
OUT=$(do_settle "$DEPLOYER_PK" "$ID1" "$ID2" "$ID3" -- 1000000); CODE=$?
assert_success SET-19a "first partial net (3,000,000 -> 2,000,000)" "$OUT" "$CODE"
OUT=$(do_settle "$DEPLOYER_PK" "$ID1" "$ID2" "$ID3" -- 1000000); CODE=$?
assert_success SET-19 "second partial net (2,000,000 -> 1,000,000), accumulates correctly" "$OUT" "$CODE"
REM=$(cast call "$REGISTRY" "getInvoice(bytes32)((address,uint64,bool,uint8,address,uint256,uint256))" "$ID1" --rpc-url "$ARC_TESTNET_RPC")
echo "  SET-19 post-check AB invoice (expect remaining=1000000): $REM" | tee -a "$RESULTS_LOG"

# ---- SET-20: settle called by one of the invoice's own parties (relayer2, funded, IS a party) ----
R2=$(addr_of "$RELAYER2_PK")
X_PK=$(pk_of SET20-X)
X=$(addr_of "$X_PK")
do_register "$DEPLOYER_PK" "SET20-R2X" 1000000 "$MAT" 1 "$RELAYER2_PK" "$X_PK" 1 >/dev/null   # relayer2 -> X
do_register "$DEPLOYER_PK" "SET20-XR2b" 1000000 "$MAT" 1 "$X_PK" "$RELAYER2_PK" 1 >/dev/null  # X -> relayer2
ID_R2X=$(invoice_id "SET20-R2X" 1000000 "$MAT" 1 "$R2" "$X" 1)
ID_XR2=$(invoice_id "SET20-XR2b" 1000000 "$MAT" 1 "$X" "$R2" 1)
Y_PK=$(pk_of SET20-Y); Y=$(addr_of "$Y_PK")
do_register "$DEPLOYER_PK" "SET20-XY" 1000000 "$MAT" 1 "$X_PK" "$Y_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "SET20-YR2" 1000000 "$MAT" 1 "$Y_PK" "$RELAYER2_PK" 1 >/dev/null
ID_XY=$(invoice_id "SET20-XY" 1000000 "$MAT" 1 "$X" "$Y" 1)
ID_YR2=$(invoice_id "SET20-YR2" 1000000 "$MAT" 1 "$Y" "$R2" 1)
# cycle: relayer2 -> X -> Y -> relayer2 (3-cycle), settle() called BY relayer2 itself
OUT=$(do_settle "$RELAYER2_PK" "$ID_R2X" "$ID_XY" "$ID_YR2" -- 100000); CODE=$?
assert_success SET-20 "settle called by relayer2, who is also a party (debtor) in the cycle" "$OUT" "$CODE"

echo "=== §3 + §8 done ===" | tee -a "$RESULTS_LOG"

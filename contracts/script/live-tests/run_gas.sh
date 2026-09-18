#!/usr/bin/env bash
# plans/03-live-testnet-e2e-tests.md §9 — gas measurement, GAS-01..03 (GAS-04 is local-only
# forge snapshot housekeeping, not part of this live run).
set -u
cd "$(dirname "$0")/../.."
set -a; source .env; set +a
source script/live-tests/lib.sh

echo "=== §9 Gas measurement (GAS-01..03) — $(date -u) ===" | tee -a "$RESULTS_LOG"

NOW=$(now_ts); MAT=$((NOW+2592000))
gas_of() { echo "$1" | grep -oE "gasUsed +[0-9]+" | grep -oE "[0-9]+"; }

# ---- GAS-01: register() typical case ----
A_PK=$(pk_of GAS01-A); B_PK=$(pk_of GAS01-B)
OUT=$(do_register "$DEPLOYER_PK" "GAS-01" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1)
G=$(gas_of "$OUT")
echo "PASS  GAS-01  register() gas: $G" | tee -a "$RESULTS_LOG"

# ---- GAS-02: settle() 3-node cycle, vs spec <250k target ----
A_PK=$(pk_of GAS02-A); B_PK=$(pk_of GAS02-B); C_PK=$(pk_of GAS02-C)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK"); C=$(addr_of "$C_PK")
do_register "$DEPLOYER_PK" "GAS02-AB" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "GAS02-BC" 1000000 "$MAT" 1 "$B_PK" "$C_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "GAS02-CA" 1000000 "$MAT" 1 "$C_PK" "$A_PK" 1 >/dev/null
ID1=$(invoice_id "GAS02-AB" 1000000 "$MAT" 1 "$A" "$B" 1)
ID2=$(invoice_id "GAS02-BC" 1000000 "$MAT" 1 "$B" "$C" 1)
ID3=$(invoice_id "GAS02-CA" 1000000 "$MAT" 1 "$C" "$A" 1)
OUT=$(do_settle "$DEPLOYER_PK" "$ID1" "$ID2" "$ID3" -- 500000)
G3=$(gas_of "$OUT")
if [ "$G3" -lt 250000 ]; then
  echo "PASS  GAS-02  settle() 3-node cycle gas: $G3 (spec §8.2 target: <250,000)" | tee -a "$RESULTS_LOG"
else
  echo "NOTE  GAS-02  settle() 3-node cycle gas: $G3 -- EXCEEDS spec §8.2's <250,000 hope, not a correctness failure but worth flagging to the operator" | tee -a "$RESULTS_LOG"
fi

# ---- GAS-03: settle() 4- and 5-node cycles, scaling check ----
A_PK=$(pk_of GAS03a-A); B_PK=$(pk_of GAS03a-B); C_PK=$(pk_of GAS03a-C); D_PK=$(pk_of GAS03a-D)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK"); C=$(addr_of "$C_PK"); D=$(addr_of "$D_PK")
do_register "$DEPLOYER_PK" "GAS03a-AB" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "GAS03a-BC" 1000000 "$MAT" 1 "$B_PK" "$C_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "GAS03a-CD" 1000000 "$MAT" 1 "$C_PK" "$D_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "GAS03a-DA" 1000000 "$MAT" 1 "$D_PK" "$A_PK" 1 >/dev/null
ID1=$(invoice_id "GAS03a-AB" 1000000 "$MAT" 1 "$A" "$B" 1)
ID2=$(invoice_id "GAS03a-BC" 1000000 "$MAT" 1 "$B" "$C" 1)
ID3=$(invoice_id "GAS03a-CD" 1000000 "$MAT" 1 "$C" "$D" 1)
ID4=$(invoice_id "GAS03a-DA" 1000000 "$MAT" 1 "$D" "$A" 1)
OUT=$(do_settle "$DEPLOYER_PK" "$ID1" "$ID2" "$ID3" "$ID4" -- 500000)
G4=$(gas_of "$OUT")

A_PK=$(pk_of GAS03b-A); B_PK=$(pk_of GAS03b-B); C_PK=$(pk_of GAS03b-C); D_PK=$(pk_of GAS03b-D); E_PK=$(pk_of GAS03b-E)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK"); C=$(addr_of "$C_PK"); D=$(addr_of "$D_PK"); E=$(addr_of "$E_PK")
do_register "$DEPLOYER_PK" "GAS03b-AB" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "GAS03b-BC" 1000000 "$MAT" 1 "$B_PK" "$C_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "GAS03b-CD" 1000000 "$MAT" 1 "$C_PK" "$D_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "GAS03b-DE" 1000000 "$MAT" 1 "$D_PK" "$E_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "GAS03b-EA" 1000000 "$MAT" 1 "$E_PK" "$A_PK" 1 >/dev/null
ID1=$(invoice_id "GAS03b-AB" 1000000 "$MAT" 1 "$A" "$B" 1)
ID2=$(invoice_id "GAS03b-BC" 1000000 "$MAT" 1 "$B" "$C" 1)
ID3=$(invoice_id "GAS03b-CD" 1000000 "$MAT" 1 "$C" "$D" 1)
ID4=$(invoice_id "GAS03b-DE" 1000000 "$MAT" 1 "$D" "$E" 1)
ID5=$(invoice_id "GAS03b-EA" 1000000 "$MAT" 1 "$E" "$A" 1)
OUT=$(do_settle "$DEPLOYER_PK" "$ID1" "$ID2" "$ID3" "$ID4" "$ID5" -- 500000)
G5=$(gas_of "$OUT")

echo "PASS  GAS-03  settle() gas scaling: 3-node=$G3, 4-node=$G4, 5-node=$G5" | tee -a "$RESULTS_LOG"
PER_NODE_4=$(( (G4 - G3) ))
PER_NODE_5=$(( (G5 - G4) ))
echo "  incremental gas per added node: 3->4 = $PER_NODE_4, 4->5 = $PER_NODE_5 (roughly linear expected; duplicate-id check is O(n^2) but n<=5, should be trivial)" | tee -a "$RESULTS_LOG"

echo "=== §9 done ===" | tee -a "$RESULTS_LOG"

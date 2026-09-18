#!/usr/bin/env bash
# plans/03-live-testnet-e2e-tests.md §4 — maturity / earlyNetConsent matrix, MAT-01..04.
# MAT-05 (real wall-clock wait) is a separate script (run_mat05.sh) since it needs to poll.
set -u
cd "$(dirname "$0")/../.."
set -a; source .env; set +a
source script/live-tests/lib.sh

echo "=== §4 Maturity/consent matrix (MAT-01..04) — $(date -u) ===" | tee -a "$RESULTS_LOG"

NOW=$(now_ts)
FUTURE=$((NOW+2592000))
PAST=$((NOW-86400))

settle3() {
  local a b c d e f wnet
  a="$1" b="$2" c="$3" d="$4" e="$5" f="$6" wnet="$7"
  do_settle "$DEPLOYER_PK" "$a" "$b" "$c" -- "$wnet"
}

# ---- MAT-01: future maturity, consent=true -> nettable ----
A_PK=$(pk_of MAT01-A); B_PK=$(pk_of MAT01-B); C_PK=$(pk_of MAT01-C)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK"); C=$(addr_of "$C_PK")
do_register "$DEPLOYER_PK" "MAT01-AB" 1000000 "$FUTURE" 1 "$A_PK" "$B_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "MAT01-BC" 1000000 "$FUTURE" 1 "$B_PK" "$C_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "MAT01-CA" 1000000 "$FUTURE" 1 "$C_PK" "$A_PK" 1 >/dev/null
ID1=$(invoice_id "MAT01-AB" 1000000 "$FUTURE" 1 "$A" "$B" 1)
ID2=$(invoice_id "MAT01-BC" 1000000 "$FUTURE" 1 "$B" "$C" 1)
ID3=$(invoice_id "MAT01-CA" 1000000 "$FUTURE" 1 "$C" "$A" 1)
OUT=$(do_settle "$DEPLOYER_PK" "$ID1" "$ID2" "$ID3" -- 100000); CODE=$?
assert_success MAT-01 "future maturity + earlyNetConsent=true -> nettable now" "$OUT" "$CODE"

# ---- MAT-02: future maturity, consent=false -> NOT nettable ----
A_PK=$(pk_of MAT02-A); B_PK=$(pk_of MAT02-B); C_PK=$(pk_of MAT02-C)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK"); C=$(addr_of "$C_PK")
do_register "$DEPLOYER_PK" "MAT02-AB" 1000000 "$FUTURE" 0 "$A_PK" "$B_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "MAT02-BC" 1000000 "$FUTURE" 1 "$B_PK" "$C_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "MAT02-CA" 1000000 "$FUTURE" 1 "$C_PK" "$A_PK" 1 >/dev/null
ID1=$(invoice_id "MAT02-AB" 1000000 "$FUTURE" 0 "$A" "$B" 1)
ID2=$(invoice_id "MAT02-BC" 1000000 "$FUTURE" 1 "$B" "$C" 1)
ID3=$(invoice_id "MAT02-CA" 1000000 "$FUTURE" 1 "$C" "$A" 1)
OUT=$(do_settle "$DEPLOYER_PK" "$ID1" "$ID2" "$ID3" -- 100000); CODE=$?
assert_revert MAT-02 "future maturity + earlyNetConsent=false -> InvoiceNotNettable" "$OUT" "$CODE" "InvoiceNotNettable"

# ---- MAT-03: past maturity, consent=false -> nettable (maturity alone sufficient) ----
A_PK=$(pk_of MAT03-A); B_PK=$(pk_of MAT03-B); C_PK=$(pk_of MAT03-C)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK"); C=$(addr_of "$C_PK")
do_register "$DEPLOYER_PK" "MAT03-AB" 1000000 "$PAST" 0 "$A_PK" "$B_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "MAT03-BC" 1000000 "$PAST" 0 "$B_PK" "$C_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "MAT03-CA" 1000000 "$PAST" 0 "$C_PK" "$A_PK" 1 >/dev/null
ID1=$(invoice_id "MAT03-AB" 1000000 "$PAST" 0 "$A" "$B" 1)
ID2=$(invoice_id "MAT03-BC" 1000000 "$PAST" 0 "$B" "$C" 1)
ID3=$(invoice_id "MAT03-CA" 1000000 "$PAST" 0 "$C" "$A" 1)
OUT=$(do_settle "$DEPLOYER_PK" "$ID1" "$ID2" "$ID3" -- 100000); CODE=$?
assert_success MAT-03 "past maturity + earlyNetConsent=false -> nettable (maturity alone sufficient)" "$OUT" "$CODE"

# ---- MAT-04: past maturity, consent=true -> nettable (both independently true) ----
A_PK=$(pk_of MAT04-A); B_PK=$(pk_of MAT04-B); C_PK=$(pk_of MAT04-C)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK"); C=$(addr_of "$C_PK")
do_register "$DEPLOYER_PK" "MAT04-AB" 1000000 "$PAST" 1 "$A_PK" "$B_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "MAT04-BC" 1000000 "$PAST" 1 "$B_PK" "$C_PK" 1 >/dev/null
do_register "$DEPLOYER_PK" "MAT04-CA" 1000000 "$PAST" 1 "$C_PK" "$A_PK" 1 >/dev/null
ID1=$(invoice_id "MAT04-AB" 1000000 "$PAST" 1 "$A" "$B" 1)
ID2=$(invoice_id "MAT04-BC" 1000000 "$PAST" 1 "$B" "$C" 1)
ID3=$(invoice_id "MAT04-CA" 1000000 "$PAST" 1 "$C" "$A" 1)
OUT=$(do_settle "$DEPLOYER_PK" "$ID1" "$ID2" "$ID3" -- 100000); CODE=$?
assert_success MAT-04 "past maturity + earlyNetConsent=true -> nettable" "$OUT" "$CODE"

echo "=== §4 (MAT-01..04) done ===" | tee -a "$RESULTS_LOG"

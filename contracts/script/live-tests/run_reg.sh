#!/usr/bin/env bash
# plans/03-live-testnet-e2e-tests.md §2 — Registry register() validation, REG-01..REG-25.
set -u
cd "$(dirname "$0")/../.."
set -a; source .env; set +a
source script/live-tests/lib.sh

echo "=== §2 Registry validation (REG-*) — $(date -u) ===" | tee -a "$RESULTS_LOG"

# 65-byte (130 hex char) dummy signature — content is irrelevant for REG-02..REG-08, which all
# revert on checks that run before signature verification (see ContraflowRegistry.register()'s
# check ordering). Built via python, not hand-typed, after an earlier hand-typed version turned
# out to have an odd digit count.
DUMMY_SIG=$(python3 -c "print('0x' + '11'*64 + '1c')")

# ---- REG-01: happy path ----
A_PK=$(pk_of REG01-A); B_PK=$(pk_of REG01-B)
NOW=$(now_ts); MAT=$((NOW+2592000))
OUT=$(do_register "$DEPLOYER_PK" "REG-01" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1); CODE=$?
assert_success REG-01 "happy path register" "$OUT" "$CODE"

# ---- REG-02: wrong currency ----
A=$(addr_of "$(pk_of REG02-A)"); B=$(addr_of "$(pk_of REG02-B)")
REF=$(cast keccak "REG-02")
OUT=$(cast send "$REGISTRY" \
  "register((bytes32,uint256,address,uint64,bool,address,address,uint256,address,uint256),bytes,bytes)" \
  "($REF,1000000,$REGISTRY,$((NOW+2592000)),true,$A,$B,1,$REGISTRY,$CHAINID)" \
  "$DUMMY_SIG" "$DUMMY_SIG" --private-key "$DEPLOYER_PK" --rpc-url "$ARC_TESTNET_RPC" 2>&1); CODE=$?
assert_revert REG-02 "wrong currency" "$OUT" "$CODE" "CurrencyMismatch"

# ---- REG-03: wrong registry field ----
REF=$(cast keccak "REG-03")
OUT=$(cast send "$REGISTRY" \
  "register((bytes32,uint256,address,uint64,bool,address,address,uint256,address,uint256),bytes,bytes)" \
  "($REF,1000000,$USDC,$((NOW+2592000)),true,$A,$B,1,$SETTLER,$CHAINID)" \
  "$DUMMY_SIG" "$DUMMY_SIG" --private-key "$DEPLOYER_PK" --rpc-url "$ARC_TESTNET_RPC" 2>&1); CODE=$?
assert_revert REG-03 "wrong registry field" "$OUT" "$CODE" "RegistryMismatch"

# ---- REG-04: wrong chainId field ----
REF=$(cast keccak "REG-04")
OUT=$(cast send "$REGISTRY" \
  "register((bytes32,uint256,address,uint64,bool,address,address,uint256,address,uint256),bytes,bytes)" \
  "($REF,1000000,$USDC,$((NOW+2592000)),true,$A,$B,1,$REGISTRY,5042)" \
  "$DUMMY_SIG" "$DUMMY_SIG" --private-key "$DEPLOYER_PK" --rpc-url "$ARC_TESTNET_RPC" 2>&1); CODE=$?
assert_revert REG-04 "wrong chainId field (mainnet id on testnet)" "$OUT" "$CODE" "ChainIdMismatch"

# ---- REG-05: zero amount ----
REF=$(cast keccak "REG-05")
OUT=$(cast send "$REGISTRY" \
  "register((bytes32,uint256,address,uint64,bool,address,address,uint256,address,uint256),bytes,bytes)" \
  "($REF,0,$USDC,$((NOW+2592000)),true,$A,$B,1,$REGISTRY,$CHAINID)" \
  "$DUMMY_SIG" "$DUMMY_SIG" --private-key "$DEPLOYER_PK" --rpc-url "$ARC_TESTNET_RPC" 2>&1); CODE=$?
assert_revert REG-05 "zero amount" "$OUT" "$CODE" "ZeroAmount"

# ---- REG-06: zero debtor ----
REF=$(cast keccak "REG-06")
OUT=$(cast send "$REGISTRY" \
  "register((bytes32,uint256,address,uint64,bool,address,address,uint256,address,uint256),bytes,bytes)" \
  "($REF,1000000,$USDC,$((NOW+2592000)),true,0x0000000000000000000000000000000000000000,$B,1,$REGISTRY,$CHAINID)" \
  "$DUMMY_SIG" "$DUMMY_SIG" --private-key "$DEPLOYER_PK" --rpc-url "$ARC_TESTNET_RPC" 2>&1); CODE=$?
assert_revert REG-06 "zero debtor" "$OUT" "$CODE" "ZeroAddress"

# ---- REG-07: zero creditor ----
REF=$(cast keccak "REG-07")
OUT=$(cast send "$REGISTRY" \
  "register((bytes32,uint256,address,uint64,bool,address,address,uint256,address,uint256),bytes,bytes)" \
  "($REF,1000000,$USDC,$((NOW+2592000)),true,$A,0x0000000000000000000000000000000000000000,1,$REGISTRY,$CHAINID)" \
  "$DUMMY_SIG" "$DUMMY_SIG" --private-key "$DEPLOYER_PK" --rpc-url "$ARC_TESTNET_RPC" 2>&1); CODE=$?
assert_revert REG-07 "zero creditor" "$OUT" "$CODE" "ZeroAddress"

# ---- REG-08: self invoice ----
REF=$(cast keccak "REG-08")
OUT=$(cast send "$REGISTRY" \
  "register((bytes32,uint256,address,uint64,bool,address,address,uint256,address,uint256),bytes,bytes)" \
  "($REF,1000000,$USDC,$((NOW+2592000)),true,$A,$A,1,$REGISTRY,$CHAINID)" \
  "$DUMMY_SIG" "$DUMMY_SIG" --private-key "$DEPLOYER_PK" --rpc-url "$ARC_TESTNET_RPC" 2>&1); CODE=$?
assert_revert REG-08 "self invoice (debtor==creditor)" "$OUT" "$CODE" "SelfInvoice"

# ---- REG-09: bad debtor signature ----
A_PK=$(pk_of REG09-A); B_PK=$(pk_of REG09-B); STRANGER_PK=$(pk_of REG09-stranger)
MAT=$((NOW+2592000))
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK")
JSON=$(build_invoice_json "REG-09" 1000000 "$MAT" true "$A" "$B" 1 | tail -1)
BAD_DSIG=$(sign_json "$STRANGER_PK" "$JSON")
GOOD_CSIG=$(sign_json "$B_PK" "$JSON")
OUT=$(do_register "$DEPLOYER_PK" "REG-09" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1 "$REGISTRY" "$CHAINID" "$BAD_DSIG" "$GOOD_CSIG"); CODE=$?
assert_revert REG-09 "bad debtor signature" "$OUT" "$CODE" "InvalidSignature"

# ---- REG-10: bad creditor signature ----
A_PK=$(pk_of REG10-A); B_PK=$(pk_of REG10-B); STRANGER_PK=$(pk_of REG10-stranger)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK")
JSON=$(build_invoice_json "REG-10" 1000000 "$MAT" true "$A" "$B" 1 | tail -1)
GOOD_DSIG=$(sign_json "$A_PK" "$JSON")
BAD_CSIG=$(sign_json "$STRANGER_PK" "$JSON")
OUT=$(do_register "$DEPLOYER_PK" "REG-10" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1 "$REGISTRY" "$CHAINID" "$GOOD_DSIG" "$BAD_CSIG"); CODE=$?
assert_revert REG-10 "bad creditor signature" "$OUT" "$CODE" "InvalidSignature"

# ---- REG-11: swapped signatures ----
A_PK=$(pk_of REG11-A); B_PK=$(pk_of REG11-B)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK")
JSON=$(build_invoice_json "REG-11" 1000000 "$MAT" true "$A" "$B" 1 | tail -1)
DSIG=$(sign_json "$A_PK" "$JSON"); CSIG=$(sign_json "$B_PK" "$JSON")
OUT=$(do_register "$DEPLOYER_PK" "REG-11" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1 "$REGISTRY" "$CHAINID" "$CSIG" "$DSIG"); CODE=$?
assert_revert REG-11 "swapped debtor/creditor signatures" "$OUT" "$CODE" "InvalidSignature"

# ---- REG-12: malformed signature length ----
A_PK=$(pk_of REG12-A); B_PK=$(pk_of REG12-B)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK")
JSON=$(build_invoice_json "REG-12" 1000000 "$MAT" true "$A" "$B" 1 | tail -1)
GOOD_DSIG=$(sign_json "$A_PK" "$JSON")
SHORT_SIG="${GOOD_DSIG:0:130}" # truncate 65 bytes -> 64 bytes
GOOD_CSIG=$(sign_json "$B_PK" "$JSON")
OUT=$(do_register "$DEPLOYER_PK" "REG-12" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1 "$REGISTRY" "$CHAINID" "$SHORT_SIG" "$GOOD_CSIG"); CODE=$?
assert_revert REG-12 "malformed (64-byte) signature length" "$OUT" "$CODE" "ECDSAInvalidSignatureLength"

# ---- REG-13: malleable high-S signature ----
A_PK=$(pk_of REG13-A); B_PK=$(pk_of REG13-B)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK")
JSON=$(build_invoice_json "REG-13" 1000000 "$MAT" true "$A" "$B" 1 | tail -1)
GOOD_DSIG=$(sign_json "$A_PK" "$JSON")
python3 - "$GOOD_DSIG" > /tmp/malleable_sig.txt <<'PYEOF'
import sys
sig = sys.argv[1][2:]
r = sig[0:64]; s = int(sig[64:128], 16); v = int(sig[128:130], 16)
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
s_high = N - s
v_flip = 28 if v == 27 else 27
print(f"0x{r}{s_high:064x}{v_flip:02x}")
PYEOF
MALLEABLE_SIG=$(cat /tmp/malleable_sig.txt)
GOOD_CSIG=$(sign_json "$B_PK" "$JSON")
OUT=$(do_register "$DEPLOYER_PK" "REG-13" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1 "$REGISTRY" "$CHAINID" "$MALLEABLE_SIG" "$GOOD_CSIG"); CODE=$?
assert_revert REG-13 "malleable high-S signature" "$OUT" "$CODE" "ECDSAInvalidSignatureS"

# ---- REG-14: exact duplicate resubmission ----
A_PK=$(pk_of REG14-A); B_PK=$(pk_of REG14-B)
OUT=$(do_register "$DEPLOYER_PK" "REG-14" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1); CODE=$?
assert_success REG-14a "first submission (setup)" "$OUT" "$CODE"
OUT=$(do_register "$DEPLOYER_PK" "REG-14" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1); CODE=$?
assert_revert REG-14 "exact duplicate resubmission" "$OUT" "$CODE" "InvoiceAlreadyRegistered"

# ---- REG-15: same nonce, different content ----
A_PK=$(pk_of REG15-A); B_PK=$(pk_of REG15-B)
OUT=$(do_register "$DEPLOYER_PK" "REG-15a" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1); CODE=$?
assert_success REG-15a "first invoice at nonce=1 (setup)" "$OUT" "$CODE"
OUT=$(do_register "$DEPLOYER_PK" "REG-15b" 2000000 "$MAT" 1 "$A_PK" "$B_PK" 1); CODE=$?
assert_revert REG-15 "different content, same nonce=1 (already used)" "$OUT" "$CODE" "NonceNotSequential"

# ---- REG-16: nonce skip on fresh pair ----
A_PK=$(pk_of REG16-A); B_PK=$(pk_of REG16-B)
OUT=$(do_register "$DEPLOYER_PK" "REG-16" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 2); CODE=$?
assert_revert REG-16 "nonce=2 as first-ever invoice for fresh pair" "$OUT" "$CODE" "NonceNotSequential"

# ---- REG-17: sequential happy path ----
A_PK=$(pk_of REG17-A); B_PK=$(pk_of REG17-B)
OUT=$(do_register "$DEPLOYER_PK" "REG-17-n1" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1); CODE=$?
assert_success REG-17-n1 "sequential nonce=1" "$OUT" "$CODE"
OUT=$(do_register "$DEPLOYER_PK" "REG-17-n2" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 2); CODE=$?
assert_success REG-17-n2 "sequential nonce=2" "$OUT" "$CODE"
OUT=$(do_register "$DEPLOYER_PK" "REG-17-n3" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 3); CODE=$?
assert_success REG-17 "sequential nonce=3" "$OUT" "$CODE"

# ---- REG-18: nonce reuse after sequence ----
OUT=$(do_register "$DEPLOYER_PK" "REG-18" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 2); CODE=$?
assert_revert REG-18 "resubmit nonce=2 after 1,2,3 already used" "$OUT" "$CODE" "NonceNotSequential"

# ---- REG-19: nonce namespace independence (same debtor) ----
A_PK=$(pk_of REG19-A); B_PK=$(pk_of REG19-B); C_PK=$(pk_of REG19-C)
OUT=$(do_register "$DEPLOYER_PK" "REG-19-AB" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1); CODE=$?
assert_success REG-19-AB "pair (A,B) nonce=1" "$OUT" "$CODE"
OUT=$(do_register "$DEPLOYER_PK" "REG-19-AC" 1000000 "$MAT" 1 "$A_PK" "$C_PK" 1); CODE=$?
assert_success REG-19 "pair (A,C) nonce=1, independent of (A,B)" "$OUT" "$CODE"

# ---- REG-20: nonce namespace independence (swapped roles) ----
A_PK=$(pk_of REG20-A); B_PK=$(pk_of REG20-B)
OUT=$(do_register "$DEPLOYER_PK" "REG-20-AB" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1); CODE=$?
assert_success REG-20-AB "pair (A as debtor, B as creditor) nonce=1" "$OUT" "$CODE"
OUT=$(do_register "$DEPLOYER_PK" "REG-20-BA" 1000000 "$MAT" 1 "$B_PK" "$A_PK" 1); CODE=$?
assert_success REG-20 "pair (B as debtor, A as creditor) nonce=1, independent" "$OUT" "$CODE"

# ---- REG-21: zero maturity ----
A_PK=$(pk_of REG21-A); B_PK=$(pk_of REG21-B)
OUT=$(do_register "$DEPLOYER_PK" "REG-21" 1000000 0 1 "$A_PK" "$B_PK" 1); CODE=$?
assert_success REG-21 "zero maturity (unconstrained at register time)" "$OUT" "$CODE"

# ---- REG-22: past maturity ----
A_PK=$(pk_of REG22-A); B_PK=$(pk_of REG22-B)
PAST=$((NOW-86400))
OUT=$(do_register "$DEPLOYER_PK" "REG-22" 1000000 "$PAST" 0 "$A_PK" "$B_PK" 1); CODE=$?
assert_success REG-22 "already-past maturity at registration, consent=false" "$OUT" "$CODE"

# ---- REG-23: repeated invoiceRef across distinct invoices ----
A_PK=$(pk_of REG23-A); B_PK=$(pk_of REG23-B)
OUT=$(do_register "$DEPLOYER_PK" "REG-23-shared-ref" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1); CODE=$?
assert_success REG-23a "first invoice with shared invoiceRef, nonce=1" "$OUT" "$CODE"
OUT=$(do_register "$DEPLOYER_PK" "REG-23-shared-ref" 2000000 "$MAT" 1 "$A_PK" "$B_PK" 2); CODE=$?
assert_success REG-23 "second invoice, same invoiceRef, different nonce/amount" "$OUT" "$CODE"

# ---- REG-24: getInvoice on unregistered id ----
# cast call's revert output doesn't decode custom error names to text the way cast send's
# gas-estimation path does — it only shows the raw selector. Confirmed 0x20bb2818 ==
# keccak256("InvoiceNotFound(bytes32)")[:4] via `cast sig "InvoiceNotFound(bytes32)"` before
# relying on this match.
RANDOM_ID=$(cast keccak "REG-24-never-registered")
OUT=$(cast call "$REGISTRY" "getInvoice(bytes32)((address,uint64,bool,uint8,address,uint256,uint256))" "$RANDOM_ID" --rpc-url "$ARC_TESTNET_RPC" 2>&1); CODE=$?
assert_revert REG-24 "getInvoice on never-registered id" "$OUT" "$CODE" "20bb2818"

# ---- REG-25: direct netInvoice call by non-settler ----
A_PK=$(pk_of REG25-A); B_PK=$(pk_of REG25-B)
OUT=$(do_register "$DEPLOYER_PK" "REG-25" 1000000 "$MAT" 1 "$A_PK" "$B_PK" 1); CODE=$?
assert_success REG-25-setup "register invoice for direct-netInvoice probe" "$OUT" "$CODE"
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK")
ID25=$(invoice_id "REG-25" 1000000 "$MAT" 1 "$A" "$B" 1)
OUT=$(cast send "$REGISTRY" "netInvoice(bytes32,uint256)" "$ID25" 100 --private-key "$DEPLOYER_PK" --rpc-url "$ARC_TESTNET_RPC" 2>&1); CODE=$?
assert_revert REG-25 "direct netInvoice call by deployer (not the Settler)" "$OUT" "$CODE" "NotSettler"

echo "=== §2 done ===" | tee -a "$RESULTS_LOG"

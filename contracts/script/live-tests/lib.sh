#!/usr/bin/env bash
# Shared shell functions for plans/03-live-testnet-e2e-tests.md's live campaign.
# Not a forge script deliberately: negative test cases need cast's own gas-estimation-time
# revert detection (exit code + decoded error name in stderr), which a forge script's
# simulate-then-abort-on-any-revert semantics can't distinguish from an actual harness bug.
# Source this, don't execute it directly: `source lib.sh`.
set -u

: "${ARC_TESTNET_RPC:?source contracts/.env first}"
: "${DEPLOYER_PK:?source contracts/.env first}"

REGISTRY=0x8a04cd9856c5A9F240C293B9fa65A7D171d8C312
SETTLER=0x3B084b5b2046E7651bb701d1cF729Be7Cb9fAf03
USDC=0x3600000000000000000000000000000000000000
CHAINID=5042002

RESULTS_LOG="${RESULTS_LOG:-/home/aduakorful/dev/contraflow/contracts/script/live-tests/results.log}"

# --- key derivation -----------------------------------------------------------------
pk_of() { cast keccak "contraflow-e2e-$1"; }
addr_of() { cast wallet address --private-key "$1"; }

# --- EIP-712 -------------------------------------------------------------------------
# build_invoice_json <invoiceRefSeed> <amount> <maturity> <earlyNetConsent true|false> \
#                     <debtorAddr> <creditorAddr> <nonce> [registryOverride] [chainIdOverride]
# Prints exactly one line: the path to the written JSON file. Nothing else — callers that also
# need the invoiceRef hash should compute it themselves via `cast keccak "<seed>"`.
build_invoice_json() {
  local ref amount maturity consent debtor creditor nonce reg cid outfile
  ref=$(cast keccak "$1"); amount="$2"; maturity="$3"; consent="$4"
  debtor="$5"; creditor="$6"; nonce="$7"
  reg="${8:-$REGISTRY}"; cid="${9:-$CHAINID}"
  outfile="/tmp/contraflow-e2e-$(echo -n "$1" | md5sum | cut -d' ' -f1)-$nonce.json"
  jq -n --arg invoiceRef "$ref" --argjson amount "$amount" --argjson maturity "$maturity" \
    --argjson consent "$consent" --arg debtor "$debtor" --arg creditor "$creditor" \
    --argjson nonce "$nonce" --arg registry "$reg" --argjson chainId "$cid" --arg usdc "$USDC" \
    '{types:{EIP712Domain:[{name:"name",type:"string"},{name:"version",type:"string"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}],InvoiceAttestation:[{name:"invoiceRef",type:"bytes32"},{name:"amount",type:"uint256"},{name:"currency",type:"address"},{name:"maturity",type:"uint64"},{name:"earlyNetConsent",type:"bool"},{name:"debtor",type:"address"},{name:"creditor",type:"address"},{name:"nonce",type:"uint256"},{name:"registry",type:"address"},{name:"chainId",type:"uint256"}]},primaryType:"InvoiceAttestation",domain:{name:"ContraflowRegistry",version:"1",chainId:$chainId,verifyingContract:$registry},message:{invoiceRef:$invoiceRef,amount:$amount,currency:$usdc,maturity:$maturity,earlyNetConsent:$consent,debtor:$debtor,creditor:$creditor,nonce:$nonce,registry:$registry,chainId:$chainId}}' \
    > "$outfile"
  echo "$outfile"
}

sign_json() { cast wallet sign --private-key "$1" --data --from-file "$2"; }

# --- core actions ----------------------------------------------------------------------
# do_register <relayerPk> <invoiceRefSeed> <amount> <maturity> <consent 0/1> \
#             <debtorPk> <creditorPk> <nonce> [registryOverride] [chainIdOverride] \
#             [debtorSigOverride] [creditorSigOverride]
# Prints the cast output; returns cast's exit code (0 = success, nonzero = reverted/rejected).
do_register() {
  local relayer_pk="$1" refseed="$2" amount="$3" maturity="$4" consent="$5"
  local debtor_pk="$6" creditor_pk="$7" nonce="$8"
  local reg="${9:-$REGISTRY}" cid="${10:-$CHAINID}"
  local dsig_override="${11:-}" csig_override="${12:-}"
  local debtor creditor jsonfile ref dsig csig consentJson

  debtor=$(addr_of "$debtor_pk"); creditor=$(addr_of "$creditor_pk")
  [ "$consent" = "1" ] && consentJson=true || consentJson=false
  jsonfile=$(build_invoice_json "$refseed" "$amount" "$maturity" "$consentJson" "$debtor" "$creditor" "$nonce" "$reg" "$cid")
  ref=$(cast keccak "$refseed")

  dsig="${dsig_override:-$(sign_json "$debtor_pk" "$jsonfile")}"
  csig="${csig_override:-$(sign_json "$creditor_pk" "$jsonfile")}"

  cast send "$reg" \
    "register((bytes32,uint256,address,uint64,bool,address,address,uint256,address,uint256),bytes,bytes)" \
    "($ref,$amount,$USDC,$maturity,$consentJson,$debtor,$creditor,$nonce,$reg,$cid)" \
    "$dsig" "$csig" \
    --private-key "$relayer_pk" --rpc-url "$ARC_TESTNET_RPC" 2>&1
}

# invoice_id <invoiceRefSeed> <amount> <maturity> <consent 0/1> <debtorAddr> <creditorAddr> <nonce> [reg] [cid]
# Recomputes the id (EIP-712 digest) purely off-chain via cast, for cases that need the id
# without re-deriving it from a tx log (e.g. building a settle() array).
invoice_id() {
  local ref amount maturity consent debtor creditor nonce reg cid domainSep structHash
  ref=$(cast keccak "$1"); amount="$2"; maturity="$3"
  [ "$4" = "1" ] && consent=true || consent=false
  debtor="$5"; creditor="$6"; nonce="$7"; reg="${8:-$REGISTRY}"; cid="${9:-$CHAINID}"

  local typehash domain_typehash name_hash version_hash
  typehash=$(cast keccak "InvoiceAttestation(bytes32 invoiceRef,uint256 amount,address currency,uint64 maturity,bool earlyNetConsent,address debtor,address creditor,uint256 nonce,address registry,uint256 chainId)")
  domain_typehash=$(cast keccak "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
  name_hash=$(cast keccak "ContraflowRegistry")
  version_hash=$(cast keccak "1")

  domainSep=$(cast keccak "$(cast abi-encode "f(bytes32,bytes32,bytes32,uint256,address)" "$domain_typehash" "$name_hash" "$version_hash" "$cid" "$reg")")
  structHash=$(cast keccak "$(cast abi-encode "f(bytes32,bytes32,uint256,address,uint64,bool,address,address,uint256,address,uint256)" \
    "$typehash" "$ref" "$amount" "$USDC" "$maturity" "$consent" "$debtor" "$creditor" "$nonce" "$reg" "$cid")")
  cast keccak "0x1901$(echo "$domainSep" | sed 's/^0x//')$(echo "$structHash" | sed 's/^0x//')"
}

# do_settle <relayerPk> <id0> <id1> [id2] [id3] [id4] -- wNet
do_settle() {
  local relayer_pk="$1"; shift
  local ids=() wnet
  while [ "$1" != "--" ]; do ids+=("$1"); shift; done
  shift; wnet="$1"
  local arr
  arr=$(printf '%s,' "${ids[@]}"); arr="[${arr%,}]"
  cast send "$SETTLER" "settle(bytes32[],uint256)" "$arr" "$wnet" \
    --private-key "$relayer_pk" --rpc-url "$ARC_TESTNET_RPC" 2>&1
}

# --- assertions / logging ------------------------------------------------------------
# assert_success <caseId> <description> <cast_output> <exit_code>
assert_success() {
  local id="$1" desc="$2" output="$3" code="$4"
  if [ "$code" -eq 0 ] && echo "$output" | grep -q "status *1 (success)"; then
    echo "PASS  $id  $desc" | tee -a "$RESULTS_LOG"
  else
    echo "FAIL  $id  $desc  ::  expected success, got:" | tee -a "$RESULTS_LOG"
    echo "$output" | tail -5 | tee -a "$RESULTS_LOG"
  fi
}

# assert_revert <caseId> <description> <cast_output> <exit_code> <expectedErrorNameSubstring>
assert_revert() {
  local id="$1" desc="$2" output="$3" code="$4" expected="$5"
  if [ "$code" -ne 0 ] && echo "$output" | grep -q "$expected"; then
    echo "PASS  $id  $desc  (reverted: $expected)" | tee -a "$RESULTS_LOG"
  else
    echo "FAIL  $id  $desc  ::  expected revert '$expected', got:" | tee -a "$RESULTS_LOG"
    echo "$output" | tail -5 | tee -a "$RESULTS_LOG"
  fi
}

now_ts() { cast block latest --rpc-url "$ARC_TESTNET_RPC" -f timestamp; }

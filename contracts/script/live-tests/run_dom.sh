#!/usr/bin/env bash
# plans/03-live-testnet-e2e-tests.md §5 — EIP-712 domain-binding attacks, DOM-01..03.
# _hashTypedDataV4 binds to THIS contract's own domain (name/version/block.chainid-at-init/
# address(this)) independent of what the invoice.registry/invoice.chainId fields merely claim.
# These cases attack the real cryptographic binding, decoupled from the explicit-field checks
# already covered in §2 (REG-03/REG-04).
set -u
cd "$(dirname "$0")/../.."
set -a; source .env; set +a
source script/live-tests/lib.sh

echo "=== §5 EIP-712 domain-binding attacks (DOM-*) — $(date -u) ===" | tee -a "$RESULTS_LOG"

NOW=$(now_ts); MAT=$((NOW+2592000))

# build_invoice_json_domain_override: like build_invoice_json but lets the domain's
# verifyingContract/chainId differ from the message's registry/chainId fields -- exactly what's
# needed to attack the binding instead of the explicit-field check.
build_json_domain_override() {
  local refseed="$1" amount="$2" maturity="$3" consent="$4" debtor="$5" creditor="$6" nonce="$7"
  local msgRegistry="$8" msgChainId="$9" domainVerifyingContract="${10}" domainChainId="${11}"
  local ref outfile
  ref=$(cast keccak "$refseed")
  outfile="/tmp/contraflow-e2e-dom-$(echo -n "$refseed" | md5sum | cut -d' ' -f1)-$nonce.json"
  jq -n --arg invoiceRef "$ref" --argjson amount "$amount" --argjson maturity "$maturity" \
    --argjson consent "$consent" --arg debtor "$debtor" --arg creditor "$creditor" \
    --argjson nonce "$nonce" --arg msgRegistry "$msgRegistry" --argjson msgChainId "$msgChainId" \
    --arg domainVC "$domainVerifyingContract" --argjson domainCID "$domainChainId" --arg usdc "$USDC" \
    '{types:{EIP712Domain:[{name:"name",type:"string"},{name:"version",type:"string"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}],InvoiceAttestation:[{name:"invoiceRef",type:"bytes32"},{name:"amount",type:"uint256"},{name:"currency",type:"address"},{name:"maturity",type:"uint64"},{name:"earlyNetConsent",type:"bool"},{name:"debtor",type:"address"},{name:"creditor",type:"address"},{name:"nonce",type:"uint256"},{name:"registry",type:"address"},{name:"chainId",type:"uint256"}]},primaryType:"InvoiceAttestation",domain:{name:"ContraflowRegistry",version:"1",chainId:$domainCID,verifyingContract:$domainVC},message:{invoiceRef:$invoiceRef,amount:$amount,currency:$usdc,maturity:$maturity,earlyNetConsent:$consent,debtor:$debtor,creditor:$creditor,nonce:$nonce,registry:$msgRegistry,chainId:$msgChainId}}' \
    > "$outfile"
  echo "$outfile"
}

# ---- DOM-01: correct domain (cross-reference; already exercised by every REG-01-style pass) ----
echo "PASS  DOM-01  correct domain signing -- already exercised by every successful register() in §2-4 (REG-01, SET-*, MAT-*)" | tee -a "$RESULTS_LOG"

# ---- DOM-02: message.registry correct (passes RegistryMismatch), but signature's domain.verifyingContract is wrong ----
A_PK=$(pk_of DOM02-A); B_PK=$(pk_of DOM02-B)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK")
JSON=$(build_json_domain_override "DOM-02" 1000000 "$MAT" true "$A" "$B" 1 "$REGISTRY" "$CHAINID" "$SETTLER" "$CHAINID")
DSIG=$(sign_json "$A_PK" "$JSON"); CSIG=$(sign_json "$B_PK" "$JSON")
REF=$(cast keccak "DOM-02")
OUT=$(cast send "$REGISTRY" \
  "register((bytes32,uint256,address,uint64,bool,address,address,uint256,address,uint256),bytes,bytes)" \
  "($REF,1000000,$USDC,$MAT,true,$A,$B,1,$REGISTRY,$CHAINID)" \
  "$DSIG" "$CSIG" --private-key "$DEPLOYER_PK" --rpc-url "$ARC_TESTNET_RPC" 2>&1); CODE=$?
assert_revert DOM-02 "invoice.registry field correct, but signature's EIP-712 domain.verifyingContract points at Settler instead" "$OUT" "$CODE" "InvalidSignature"

# ---- DOM-03: message.chainId correct (passes ChainIdMismatch), but signature's domain.chainId is mainnet (5042) ----
A_PK=$(pk_of DOM03-A); B_PK=$(pk_of DOM03-B)
A=$(addr_of "$A_PK"); B=$(addr_of "$B_PK")
JSON=$(build_json_domain_override "DOM-03" 1000000 "$MAT" true "$A" "$B" 1 "$REGISTRY" "$CHAINID" "$REGISTRY" 5042)
DSIG=$(sign_json "$A_PK" "$JSON"); CSIG=$(sign_json "$B_PK" "$JSON")
REF=$(cast keccak "DOM-03")
OUT=$(cast send "$REGISTRY" \
  "register((bytes32,uint256,address,uint64,bool,address,address,uint256,address,uint256),bytes,bytes)" \
  "($REF,1000000,$USDC,$MAT,true,$A,$B,1,$REGISTRY,$CHAINID)" \
  "$DSIG" "$CSIG" --private-key "$DEPLOYER_PK" --rpc-url "$ARC_TESTNET_RPC" 2>&1); CODE=$?
assert_revert DOM-03 "invoice.chainId field correct (testnet), but signature's EIP-712 domain.chainId is mainnet (5042) -- the cross-network replay attempt" "$OUT" "$CODE" "InvalidSignature"

echo "=== §5 done ===" | tee -a "$RESULTS_LOG"

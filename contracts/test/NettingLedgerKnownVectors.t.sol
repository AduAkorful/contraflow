// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {ContraflowNettingLedger} from "../src/ContraflowNettingLedger.sol";
import {CertificateEntry, NettingCertificate, NettingObligation} from "../src/interfaces/IContraflowNettingLedger.sol";
import {NettingSigningHelpers} from "./helpers/NettingSigningHelpers.sol";

/// @notice Fixed inputs and their expected hashes, shared with the app's TypeScript tests so the
/// two implementations are proven to agree byte for byte. Domain: chain id 31337, the ledger
/// proxy at `LEDGER`. Parties are the addresses of private keys 0xA11CE, 0xB0B and 0xCA401.
/// If any constant here changes, the TypeScript vectors must change with it.
contract NettingLedgerKnownVectorsTest is NettingSigningHelpers {
    address internal constant LEDGER = 0x2e234DAe75C793f67A35089C9d99245E1C58470b;
    bytes32 internal constant OBLIGATION_ID = 0x8e6ba142d646c71edd39397542dde23b09a1e11f4f9012920b2ad3a6dfa4087e;
    bytes32 internal constant OBLIGATION_KEY = 0x75a80c709265704c21b219f34bb2dec65f5810218b8515a5df8c774a631e9e0c;
    bytes32 internal constant FIRST_COMMITMENT = 0x2c75fc6537b4d6a30984df2b3571c8780cd950add59d89bbda3d0d28003412e2;
    bytes32 internal constant CERTIFICATE_DIGEST = 0x0d231d77cddd83d5d2dbbc7359744abb2afd1f620a045849876bd04a9d815ad8;
    bytes internal constant ALICE_SIGNATURE =
        hex"a902dd5c2d8c19f576b1825cb7bb44a60c2282d434f2998566e2eb5a2ac1760c23985d08dd4c0592092181f567a027f7611029060431d4373188e234abf799c41c";

    ContraflowNettingLedger internal ledger;

    function setUp() public {
        ContraflowNettingLedger impl = new ContraflowNettingLedger();
        ledger = ContraflowNettingLedger(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(ContraflowNettingLedger.initialize, (address(0xBEEF)))))
        );
    }

    function _obligation() internal pure returns (NettingObligation memory) {
        return NettingObligation({
            documentHash: keccak256("INV-1042: consulting, September 2026"),
            debtor: vm.addr(0xA11CE),
            creditor: vm.addr(0xB0B),
            currency: "USD",
            amount: 1_250_00,
            maturity: 1_800_000_000,
            earlyNetConsent: true,
            salt: keccak256("salt-1042")
        });
    }

    function _certificate() internal pure returns (NettingCertificate memory cert) {
        address[3] memory p = [vm.addr(0xA11CE), vm.addr(0xB0B), vm.addr(0xCA401)];
        cert.certificateId = keccak256("certificate-1");
        cert.contentHash = keccak256("certificate-1 document");
        cert.deadline = 1_800_000_000;
        cert.entries = new CertificateEntry[](3);
        for (uint256 i = 0; i < 3; ++i) {
            bytes32 id = keccak256(abi.encode("obligation", i));
            cert.entries[i] = CertificateEntry({
                obligationId: id,
                debtor: p[i],
                creditor: p[(i + 1) % 3],
                priorCommitment: bytes32(0),
                nextCommitment: _commitment(id, 250_00 * (i + 1), keccak256(abi.encode("blinding", i)))
            });
        }
    }

    function test_knownVectors_matchContractAndIndependentHashing() public view {
        NettingObligation memory o = _obligation();
        NettingCertificate memory c = _certificate();

        assertEq(address(ledger), LEDGER, "deterministic test deployment moved; regenerate vectors");

        bytes32 obligationId = ledger.obligationId(o);
        assertEq(obligationId, OBLIGATION_ID);
        assertEq(_obligationDigest(o, address(ledger)), OBLIGATION_ID);

        assertEq(ledger.obligationKey(obligationId, o.debtor, o.creditor), OBLIGATION_KEY);
        assertEq(_obligationKeyOf(obligationId, o.debtor, o.creditor), OBLIGATION_KEY);

        assertEq(c.entries[0].nextCommitment, FIRST_COMMITMENT);

        assertEq(ledger.certificateDigest(c), CERTIFICATE_DIGEST);
        assertEq(_certDigest(c, address(ledger)), CERTIFICATE_DIGEST);

        // RFC 6979 signing is deterministic, so viem must produce these exact bytes too.
        assertEq(_signDigest(0xA11CE, CERTIFICATE_DIGEST), ALICE_SIGNATURE);
    }
}

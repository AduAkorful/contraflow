# FAQ

**Does settling a cycle legally discharge the debt?**
No. An on-chain settlement is a real, verifiable on-chain event — it is not a statutory legal
discharge of debt under any accounting or legal standard. Treat it as what it is, not as a legal
opinion.

**Who can trigger settlement?**
Anyone, once a cycle is fully attested. Settlement isn't gated behind the team — it's
permissionless by design.

**Is there a fee?**
No protocol fee today. You pay standard Arc network gas and nothing else. That could change in a
future version of the protocol (see the upgrade disclosure below).

**Are the contracts immutable?**
No. They're upgradeable behind a single administrative key held by the team — not a multisig or a
DAO vote. This is disclosed plainly rather than claimed away, because it's a real point of trust
in the team.

**Does Contraflow screen addresses for sanctions or AML?**
In this phase, address screening is a manually maintained list, not a full compliance vendor
integration, and Arc validators don't screen transactions on the protocol's behalf. Using
Contraflow is not AML/OFAC clearance.

**What happens if I enter the wrong amount, or my counterparty never signs?**
Nothing is recorded on-chain until both signatures exist. An incomplete or malformed attestation
simply never becomes a live invoice.

**Can I use this for real invoices today?**
This is early-stage software interacting with real funds on a real blockchain, and has not been
through a formal third-party audit. Verify contract addresses and transaction results yourself on
the Arc explorer before relying on anything the app shows you.

**Is there an API?**
Not yet. See [API](api/README.md).

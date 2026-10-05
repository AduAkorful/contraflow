# FAQ

**What's the difference between invoices and obligations?**
Invoices are USDC debts registered on Arc; a loop of them is cancelled in one transaction.
Obligations are debts in any currency that stay offchain; a loop of them nets out with one
certificate everyone in it signs.

**Which currencies can obligations be in?**
Any ISO 4217 currency. The app lists common ones and accepts any other ISO code. A certificate only ever nets
obligations in the same currency.

**Can the same debt be netted twice?**
No. The netting ledger only accepts a certificate that starts from each obligation's current
recorded state, and applying it replaces that state.

**Who can see my obligations?**
Your counterparty on each one, and Contraflow, which needs them to find loops. On a certificate,
each party only sees their own obligations and the amount netted. The amounts never go onchain.
See [Trust and security](how-it-works.md#trust-and-security) for what is public.

**Does a settlement or certificate legally discharge the debt?**
No. It's a signed record that works alongside your agreements with your counterparties. See
[Trust and security](how-it-works.md#trust-and-security).

**Who can trigger settlement?**
Anyone, once a loop is fully signed. It isn't gated behind Contraflow.

**Is there a fee?**
No protocol fee today. You pay Arc network gas, and recording an obligation costs nothing.

**Can the contracts change?**
Yes, they're upgradeable. See [Trust and security](how-it-works.md#trust-and-security).

**What happens if my counterparty never signs?**
Nothing. A debt with only one signature is never registered or netted.

**Is there an API?**
Yes. Platforms such as ERPs, accounting apps and marketplaces can record offchain obligations, find netting loops
and apply certificates for their customers over HTTPS. Access is by request. See [API](api/README.md).

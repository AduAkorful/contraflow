import Link from "next/link";
import { MarketingPage } from "../../components/marketing/MarketingPage";
import { docsNavLink } from "../../src/site/docsUrl";
import { APP_CHAIN_ID, addressesForChain } from "../../src/contracts/addresses";
import { explorerAddressUrl } from "../../src/blockscout/explorer";
import { sourcifyLookupUrl } from "../../src/site/sourcify";
import { Address } from "../../components/ui/Address";

export const metadata = { title: "Integrations" };

type External = { title: string; body: string; href: string; label: string };

const VENDORS: External[] = [
  {
    title: "Arc",
    body: "Invoices, settlements and netting certificates are recorded on Arc, with gas paid in native USDC.",
    href: "https://docs.arc.io/",
    label: "Arc docs ↗",
  },
  {
    title: "Privy",
    body: "Sign in with the wallet you already use, or with your email.",
    href: "https://docs.privy.io/",
    label: "Privy docs ↗",
  },
];

export default function IntegrationsPage() {
  const docs = docsNavLink();
  const addresses = addressesForChain(APP_CHAIN_ID);
  const contracts = [
    { name: "Registry", address: addresses.registry },
    { name: "Settler", address: addresses.settler },
    { name: "Netting ledger", address: addresses.nettingLedger },
  ];

  return (
    <MarketingPage>
      <section className="mx-auto max-w-4xl px-6 pb-12 pt-10 text-center">
        <h1 className="font-serif-display text-5xl leading-[1.05]">Integrations &amp; API</h1>
        <p className="mx-auto mt-6 max-w-xl text-muted">
          Record offchain obligations from your own product. Contraflow never signs for tenants.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <h2 className="font-serif-display text-3xl">API</h2>
        <p className="mt-4 max-w-2xl text-muted">
          Parties grant scoped, expiring permissions. Tenants submit the signatures those parties
          made. Keys are operator-issued. There is no invoice or settlement API: those stay in the
          app, signed and paid by the party.
        </p>
        <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {docs.external ? (
            <a href={docs.href} target="_blank" rel="noreferrer" className="text-gold hover:underline">
              Docs ↗
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <Link href={docs.href} className="text-gold hover:underline">
              Docs
            </Link>
          )}
          <Link href="/contact" className="text-gold hover:underline">
            Request an API key
          </Link>
          <a href="/api/v1/openapi.json" className="text-gold hover:underline">
            OpenAPI
          </a>
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <h2 className="font-serif-display text-3xl">In the app</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {VENDORS.map((item) => (
            <div key={item.title} className="rounded-card border border-border-subtle bg-surface-1 p-6">
              <h3 className="font-medium">{item.title}</h3>
              <p className="mt-2 text-sm text-muted">{item.body}</p>
              <a href={item.href} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm text-gold hover:underline">
                {item.label}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <h2 className="font-serif-display text-3xl">Contracts on Arc</h2>
        <p className="mt-4 max-w-2xl text-muted">
          Source is verified on Sourcify. Every transaction is on the Arc explorer.
        </p>
        <ul className="mt-10 grid gap-6 sm:grid-cols-3">
          {contracts.map((contract) => {
            const explorer = explorerAddressUrl(APP_CHAIN_ID, contract.address);
            return (
              <li key={contract.name} className="rounded-card border border-border-subtle bg-surface-1 p-6">
                <h3 className="font-medium">{contract.name}</h3>
                <p className="mt-3">
                  <Address address={contract.address} chainId={APP_CHAIN_ID} />
                </p>
                <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  {explorer ? (
                    <a href={explorer} target="_blank" rel="noreferrer" className="text-gold hover:underline">
                      Explorer ↗
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : null}
                  <a
                    href={sourcifyLookupUrl(contract.address)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-gold hover:underline"
                  >
                    Sourcify ↗
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    </MarketingPage>
  );
}

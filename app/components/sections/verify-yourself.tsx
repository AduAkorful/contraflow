import Link from "next/link";
import { APP_CHAIN_ID, addressesForChain } from "../../src/contracts/addresses";
import { explorerAddressUrl } from "../../src/blockscout/explorer";
import { sourcifyLookupUrl } from "../../src/site/sourcify";
import { Address } from "../ui/Address";
import { Gloss } from "../marketing/Gloss";

const CONTRACTS = [
  { key: "registry" as const, name: "Registry", what: "Stores signed USDC invoices." },
  { key: "settler" as const, name: "Settler", what: "Nets a loop of invoices in one transaction." },
  { key: "nettingLedger" as const, name: "Netting ledger", what: "Records each applied obligation certificate." },
];

export function VerifyYourself() {
  const addresses = addressesForChain(APP_CHAIN_ID);

  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-serif-display text-4xl">Verify it yourself</h2>
        <p className="mt-4 text-muted">
          Three contracts on Arc, source checked on{" "}
          <Gloss title="A public verifier that matches deployed bytecode to published source.">Sourcify</Gloss>
          . Check a certificate in your browser, or look up a settlement on the explorer.
        </p>
      </div>
      <ul className="mt-12 grid gap-6 sm:grid-cols-3">
        {CONTRACTS.map((contract) => {
          const address = addresses[contract.key];
          const explorer = explorerAddressUrl(APP_CHAIN_ID, address);
          return (
            <li key={contract.key} className="rounded-card border border-border-subtle bg-surface-1 p-6">
              <h3 className="text-lg font-medium">{contract.name}</h3>
              <p className="mt-2 text-sm text-muted">{contract.what}</p>
              <p className="mt-4">
                <Address address={address} chainId={APP_CHAIN_ID} />
              </p>
              <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                {explorer ? (
                  <a href={explorer} target="_blank" rel="noreferrer" className="text-gold hover:underline">
                    Explorer ↗
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : null}
                <a
                  href={sourcifyLookupUrl(address)}
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
      <p className="mt-8 text-center text-sm text-muted">
        <Link href="/app/verify" className="text-gold hover:underline">
          Verify a certificate
        </Link>
        {" · "}
        <Link href="/app/history" className="text-gold hover:underline">
          Look up a settlement
        </Link>
      </p>
    </section>
  );
}

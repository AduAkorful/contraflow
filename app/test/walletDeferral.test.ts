import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function source(path: string): string {
  return readFileSync(path, "utf8");
}

const STATIC_WALLET = /from ["'](?:wagmi|@privy-io\/react-auth|@privy-io\/wagmi)["']/;
const APP_KIT_ROOT = /from ["']@circle-fin\/app-kit["']/;

describe("wallet deferral", () => {
  it("keeps Privy and wagmi out of signed-out chrome", () => {
    const chrome = [
      "components/app-shell/AppShell.tsx",
      "components/app-shell/TopBar.tsx",
      "components/app-shell/NetworkChip.tsx",
      "components/wallet/WalletHost.tsx",
      "components/wallet/signInContext.tsx",
      "components/wallet/useSignIn.tsx",
      "components/wallet/ConnectButton.tsx",
      "components/overview/SignInOverlay.tsx",
      "src/app/app/layout.tsx",
    ];
    for (const path of chrome) {
      expect(source(join(root, path)), path).not.toMatch(STATIC_WALLET);
    }
  });

  it("keeps Privy and wagmi out of read-only /app pages", () => {
    const dirs = [
      "src/app/app/history",
      "src/app/app/receipt",
      "src/app/app/verify",
      "src/app/app/demo",
    ];
    for (const dir of dirs) {
      for (const path of files(join(root, dir))) {
        expect(source(path), relative(root, path)).not.toMatch(STATIC_WALLET);
      }
    }
  });

  it("loads Privy through a dynamic import from WalletHost", () => {
    const host = source(join(root, "components/wallet/WalletHost.tsx"));
    expect(host).toMatch(/dynamic\(\(\) => import\(/);
    expect(host).toMatch(/providers/);
    expect(source(join(root, "src/app/app/layout.tsx"))).toMatch(/WalletHost/);
    expect(source(join(root, "src/app/app/layout.tsx"))).not.toMatch(/from ["']\.\/providers["']/);
    expect(source(join(root, "src/app/app/page.tsx"))).toMatch(/import\([\s\S]*["']\.\/Overview["']\)/);
    expect(source(join(root, "src/app/app/page.tsx"))).not.toMatch(/import \{ Overview \} from ["']\.\/Overview["']/);
  });

  it("does not import the App Kit root from browser pages except balance", () => {
    const appPages = files(join(root, "src/app/app")).filter((path) => !path.includes("/balance/"));
    const chrome = files(join(root, "components")).filter((path) => !path.includes("/balance/"));
    for (const path of [...appPages, ...chrome]) {
      if (path.endsWith("quote/actions.ts")) continue;
      expect(source(path), relative(root, path)).not.toMatch(APP_KIT_ROOT);
    }
  });
});

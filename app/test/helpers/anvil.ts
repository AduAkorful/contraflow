/// Spins up a local anvil instance for the integration test — real compiled contracts, real EVM
/// execution, zero live network or gas cost. Chain id is forced to Arc testnet's own id
/// (5042002) so the same `arcTestnet` chain definition from `src/chain/client.ts` applies
/// unchanged; this is a different, disposable chain, not a connection to the real network.

import { spawn, type ChildProcess } from "node:child_process";

export interface AnvilInstance {
  rpcUrl: string;
  process: ChildProcess;
  /// Anvil's own default test accounts' private keys, in the order anvil printed them at
  /// startup. Parsed from its stdout rather than hardcoded — deliberately, after this same
  /// session hand-typed three of these hex strings from memory and got them subtly wrong (a
  /// missing trailing digit). Not secrets: these are Foundry's published, universally-known
  /// throwaway test keys, but "known" is still not a reason to retype them by hand.
  privateKeys: `0x${string}`[];
  stop: () => void;
}

export async function startAnvil(port: number, chainId: number): Promise<AnvilInstance> {
  const child = spawn("anvil", ["--port", String(port), "--chain-id", String(chainId)]);

  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  const rpcUrl = `http://127.0.0.1:${port}`;
  await waitForRpc(rpcUrl);

  const privateKeys = parsePrivateKeys(output);
  if (privateKeys.length === 0) {
    throw new Error("startAnvil: could not parse any private keys from anvil's startup output");
  }

  return { rpcUrl, process: child, privateKeys, stop: () => child.kill() };
}

function parsePrivateKeys(anvilOutput: string): `0x${string}`[] {
  const section = anvilOutput.split("Private Keys")[1] ?? "";
  const matches = section.matchAll(/\((\d+)\)\s+(0x[0-9a-fA-F]{64})/g);
  return Array.from(matches, (m) => m[2] as `0x${string}`);
}

async function waitForRpc(rpcUrl: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`anvil at ${rpcUrl} did not become ready in time: ${String(lastError)}`);
}

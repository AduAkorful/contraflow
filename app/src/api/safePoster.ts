/// The webhook delivery poster. Re-validates the URL on every attempt and rejects blocked
/// addresses at connect time (not just beforehand), so a DNS change between check and use can't
/// reach an internal host. Redirects are never followed: a 3xx is returned as a status and counts
/// as a failure, so a webhook is never sent somewhere unregistered.

import http from "node:http";
import https from "node:https";
import { lookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { blockedAddress, checkWebhookUrl } from "./webhookUrl";

export type Lookup = (hostname: string, options: { all: true }, cb: (err: Error | null, addresses: LookupAddress[]) => void) => void;

export interface SafePosterOptions {
  lookup?: Lookup;
  timeoutMs?: number;
  allowLocalHttp?: boolean;
}

const TIMEOUT_MS = 10_000;

export function createSafePoster(options: SafePosterOptions = {}) {
  const resolve: Lookup = options.lookup ?? ((host, opts, cb) => lookup(host, { ...opts, verbatim: true }, cb));
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const allowLocalHttp = options.allowLocalHttp ?? process.env.NODE_ENV !== "production";

  return async function post(rawUrl: string, body: string, headers: Record<string, string>): Promise<number> {
    const checked = checkWebhookUrl(rawUrl, { allowLocalHttp });
    if (!checked.ok) throw new Error(checked.error);
    const url = checked.url;
    const secure = url.protocol === "https:";

    const guardedLookup = (hostname: string, lookupOptions: unknown, callback: (...args: unknown[]) => void) => {
      resolve(hostname, { all: true }, (err, addresses) => {
        if (err) return callback(err);
        if (addresses.length === 0 || addresses.some((a) => blockedAddress(a.address))) {
          return callback(new Error("Webhook host resolves to a private or reserved address."));
        }
        const wantsAll = typeof lookupOptions === "object" && lookupOptions !== null && (lookupOptions as { all?: boolean }).all;
        if (wantsAll) return callback(null, addresses);
        return callback(null, addresses[0]!.address, addresses[0]!.family);
      });
    };

    const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
    const literal = isIP(hostname) !== 0;
    const local = !secure;

    return new Promise<number>((resolvePromise, reject) => {
      const transport = secure ? https : http;
      const req = transport.request(
        {
          method: "POST",
          hostname,
          port: url.port || (secure ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) },
          // A literal IP skips lookup, and a local receiver is the one allowed internal target.
          ...(literal || local ? {} : { lookup: guardedLookup as never }),
          timeout: timeoutMs,
        },
        (res) => {
          res.resume();
          resolvePromise(res.statusCode ?? 0);
        },
      );
      req.on("timeout", () => req.destroy(new Error("Webhook request timed out.")));
      req.on("error", reject);
      req.end(body);
    });
  };
}

export const safePoster = createSafePoster();

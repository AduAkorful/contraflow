/// Validation for webhook endpoint URLs. Delivery runs on Contraflow's servers, so a tenant-chosen
/// URL must never reach an internal address. These checks run when an endpoint is saved and again
/// before every delivery (`safePoster`).

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_URL_LENGTH = 2048;
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".lan", ".intranet"];

function ipv4Bytes(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

function ipv4Blocked([a, b, c]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b! >= 64 && b! <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b! >= 16 && b! <= 31) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return a! >= 224;
}

function ipv6Bytes(address: string): number[] | null {
  if (address.includes("%")) return null;
  let text = address.toLowerCase();
  const tail = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    const v4 = ipv4Bytes(tail[1]!);
    if (!v4) return null;
    const hi = ((v4[0]! << 8) | v4[1]!).toString(16);
    const lo = ((v4[2]! << 8) | v4[3]!).toString(16);
    text = `${text.slice(0, -tail[1]!.length)}${hi}:${lo}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const value = parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}

function ipv6Blocked(b: number[]): boolean {
  const zeros = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  if (zeros(0, 10) && b[10] === 0xff && b[11] === 0xff) return ipv4Blocked(b.slice(12, 16)); // IPv4-mapped
  if (zeros(0, 12)) return true; // unspecified, loopback, IPv4-compatible
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(4, 12)) return ipv4Blocked(b.slice(12, 16)); // NAT64
  if (b[0] === 0x20 && b[1] === 0x02) return ipv4Blocked(b.slice(2, 6)); // 6to4
  if (b[0] === 0x20 && b[1] === 0x01 && (b[2] === 0 || (b[2] === 0x0d && b[3] === 0xb8))) return true; // Teredo, documentation
  if (b[0] === 0x01 && zeros(1, 8)) return true; // discard prefix
  if ((b[0]! & 0xfe) === 0xfc) return true; // unique local
  if (b[0] === 0xfe && (b[1]! & 0xc0) >= 0x80) return true; // link-local and site-local
  return b[0] === 0xff; // multicast
}

/// True for any address a webhook must never be sent to. Unparseable input counts as blocked.
export function blockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const bytes = ipv4Bytes(address);
    return !bytes || ipv4Blocked(bytes);
  }
  if (family === 6) {
    const bytes = ipv6Bytes(address);
    return !bytes || ipv6Blocked(bytes);
  }
  return true;
}

export type WebhookUrlCheck = { ok: true; url: URL } | { ok: false; error: string };

const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/// Static checks only (no DNS). `allowLocalHttp` is for local receivers outside production.
export function checkWebhookUrl(raw: string, options: { allowLocalHttp?: boolean } = {}): WebhookUrlCheck {
  const text = raw.trim();
  if (text.length === 0 || text.length > MAX_URL_LENGTH) return { ok: false, error: "Enter a URL of up to 2,048 characters." };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "That isn't a valid URL." };
  }
  const localHttp = options.allowLocalHttp === true && url.protocol === "http:" && LOCAL_HTTP_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !localHttp) return { ok: false, error: "Webhook URLs must start with https://." };
  if (url.username || url.password) return { ok: false, error: "Remove the username and password from the URL." };
  if (!localHttp && url.port !== "" && url.port !== "443") return { ok: false, error: "Use the default HTTPS port (443)." };
  url.hash = "";
  if (localHttp) return { ok: true, url };

  const host = url.hostname.toLowerCase();
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (isIP(bare) !== 0) {
    if (blockedAddress(bare)) return { ok: false, error: "That address is private or reserved. Use a public hostname." };
    return { ok: true, url };
  }
  if (!host.includes(".") || host === "localhost" || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return { ok: false, error: "Use a public hostname that Contraflow can reach." };
  }
  return { ok: true, url };
}

export type ResolveAll = (hostname: string) => Promise<{ address: string }[]>;

const resolveAll: ResolveAll = (hostname) => lookup(hostname, { all: true, verbatim: true });

/// Resolves a hostname and refuses it if any returned address is blocked.
export async function checkResolvedHost(hostname: string, resolve: ResolveAll = resolveAll): Promise<{ ok: true } | { ok: false; error: string }> {
  const bare = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (isIP(bare) !== 0) return blockedAddress(bare) ? { ok: false, error: "That address is private or reserved. Use a public hostname." } : { ok: true };
  let addresses: { address: string }[];
  try {
    addresses = await resolve(bare);
  } catch {
    return { ok: false, error: "Couldn't find that hostname. Check the URL." };
  }
  if (addresses.length === 0) return { ok: false, error: "Couldn't find that hostname. Check the URL." };
  if (addresses.some((a) => blockedAddress(a.address))) {
    return { ok: false, error: "That hostname points to a private or reserved address." };
  }
  return { ok: true };
}

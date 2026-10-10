import { describe, expect, it } from "vitest";
import { blockedAddress, checkResolvedHost, checkWebhookUrl } from "../src/api/webhookUrl";

describe("blockedAddress", () => {
  it.each([
    "0.0.0.0", "10.1.2.3", "127.0.0.1", "127.255.255.254", "100.64.0.1", "100.127.255.255", "169.254.169.254",
    "172.16.0.1", "172.31.255.255", "192.168.1.1", "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.7",
    "203.0.113.9", "224.0.0.1", "240.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1",
    "2002:7f00:1::1", "fc00::1", "fd12:3456::1", "fe80::1", "fec0::1", "ff02::1", "2001:db8::1", "2001::1", "100::1",
  ])("blocks %s", (address) => {
    expect(blockedAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "100.63.0.1", "100.128.0.1", "93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"])(
    "allows %s",
    (address) => {
      expect(blockedAddress(address)).toBe(false);
    },
  );

  it("treats anything that isn't an address as blocked", () => {
    expect(blockedAddress("example.com")).toBe(true);
    expect(blockedAddress("")).toBe(true);
    expect(blockedAddress("999.1.1.1")).toBe(true);
  });
});

describe("checkWebhookUrl", () => {
  it("accepts a public https URL and strips the fragment", () => {
    const result = checkWebhookUrl("https://hooks.example.com/contraflow?x=1#frag");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url.toString()).toBe("https://hooks.example.com/contraflow?x=1");
  });

  it.each([
    ["http://example.com/hook", "https://"],
    ["ftp://example.com/hook", "https://"],
    ["https://user:pass@example.com/hook", "username"],
    ["https://example.com:8443/hook", "port"],
    ["https://localhost/hook", "public hostname"],
    ["https://intranet/hook", "public hostname"],
    ["https://db.internal/hook", "public hostname"],
    ["https://printer.local/hook", "public hostname"],
    ["https://127.0.0.1/hook", "private"],
    ["https://2130706433/hook", "private"],
    ["https://0x7f.1/hook", "private"],
    ["https://169.254.169.254/latest/meta-data", "private"],
    ["https://[::1]/hook", "private"],
    ["https://[::ffff:127.0.0.1]/hook", "private"],
    ["not a url", "valid URL"],
    ["", "URL"],
  ])("refuses %s", (raw, message) => {
    const result = checkWebhookUrl(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });

  it("allows plain http only for local hosts, and only when asked", () => {
    expect(checkWebhookUrl("http://localhost:4000/hook").ok).toBe(false);
    expect(checkWebhookUrl("http://localhost:4000/hook", { allowLocalHttp: true }).ok).toBe(true);
    expect(checkWebhookUrl("http://127.0.0.1:4000/hook", { allowLocalHttp: true }).ok).toBe(true);
    expect(checkWebhookUrl("http://10.0.0.5/hook", { allowLocalHttp: true }).ok).toBe(false);
    expect(checkWebhookUrl("http://example.com/hook", { allowLocalHttp: true }).ok).toBe(false);
  });
});

describe("checkResolvedHost", () => {
  it("accepts a hostname whose addresses are all public", async () => {
    const result = await checkResolvedHost("hooks.example.com", async () => [{ address: "93.184.216.34" }, { address: "2606:4700:4700::1111" }]);
    expect(result.ok).toBe(true);
  });

  it("refuses when any returned address is internal", async () => {
    const result = await checkResolvedHost("hooks.example.com", async () => [{ address: "93.184.216.34" }, { address: "10.0.0.8" }]);
    expect(result).toEqual({ ok: false, error: "That hostname points to a private or reserved address." });
  });

  it("refuses an unresolvable or empty answer", async () => {
    expect((await checkResolvedHost("nope.example.com", async () => { throw new Error("ENOTFOUND"); })).ok).toBe(false);
    expect((await checkResolvedHost("nope.example.com", async () => [])).ok).toBe(false);
  });
});

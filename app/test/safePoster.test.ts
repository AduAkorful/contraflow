import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createSafePoster } from "../src/api/safePoster";

const servers: http.Server[] = [];

function receiver(handler: http.RequestListener): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer(handler).listen(0, "127.0.0.1", () => {
      servers.push(server);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

describe("safePoster", () => {
  it("refuses an https URL whose hostname resolves to an internal address, without connecting", async () => {
    let lookups = 0;
    const post = createSafePoster({
      allowLocalHttp: false,
      lookup: (_host, _opts, cb) => {
        lookups++;
        cb(null, [{ address: "10.0.0.8", family: 4 }]);
      },
    });
    await expect(post("https://hooks.example.com/x", "{}", {})).rejects.toThrow(/private or reserved/);
    expect(lookups).toBe(1);
  });

  it("refuses a rebinding answer that mixes a public and an internal address", async () => {
    const post = createSafePoster({
      allowLocalHttp: false,
      lookup: (_host, _opts, cb) =>
        cb(null, [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ]),
    });
    await expect(post("https://hooks.example.com/x", "{}", {})).rejects.toThrow(/private or reserved/);
  });

  it("refuses IP literals and unsafe URLs before any lookup", async () => {
    let lookups = 0;
    const post = createSafePoster({
      allowLocalHttp: false,
      lookup: (_h, _o, cb) => {
        lookups++;
        cb(null, []);
      },
    });
    await expect(post("https://169.254.169.254/latest", "{}", {})).rejects.toThrow(/private or reserved/);
    await expect(post("http://example.com/x", "{}", {})).rejects.toThrow(/https/);
    await expect(post("https://localhost/x", "{}", {})).rejects.toThrow();
    expect(lookups).toBe(0);
  });

  it("delivers to a local http receiver when local http is allowed, and does not follow redirects", async () => {
    let seen = "";
    const port = await receiver((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: "http://127.0.0.1:1/never" }).end();
        return;
      }
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen = `${req.headers["x-test"]}:${body}`;
        res.writeHead(204).end();
      });
    });
    const post = createSafePoster({ allowLocalHttp: true });
    expect(await post(`http://127.0.0.1:${port}/hook`, '{"a":1}', { "Content-Type": "application/json", "x-test": "yes" })).toBe(204);
    expect(seen).toBe('yes:{"a":1}');
    expect(await post(`http://127.0.0.1:${port}/redirect`, "{}", {})).toBe(302);
  });

  it("refuses local http when local http is not allowed", async () => {
    const port = await receiver((_req, res) => res.writeHead(204).end());
    const post = createSafePoster({ allowLocalHttp: false });
    await expect(post(`http://127.0.0.1:${port}/hook`, "{}", {})).rejects.toThrow();
  });

  it("times out a receiver that never answers", async () => {
    const port = await receiver(() => {
      /* never respond */
    });
    const post = createSafePoster({ allowLocalHttp: true, timeoutMs: 100 });
    await expect(post(`http://127.0.0.1:${port}/hook`, "{}", {})).rejects.toThrow(/timed out/);
  });
});

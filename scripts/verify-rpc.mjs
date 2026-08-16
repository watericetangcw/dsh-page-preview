// Offline validation of the fixed RPC registration path:
// rpc.handle(channel, handler, {}) against the real HostConnectionService.
import { Context } from "@deepseek-ai/cordis";
import { HostConnectionService } from "@deepseek-ai/dsh-client-connection";

const ctx = new Context();
const routes = [];
ctx.provide("webServer", {
  register: (route) => { routes.push(route); return () => { routes.splice(routes.indexOf(route), 1); }; },
});

// The connection provider (mirrors the shipped row's apply).
await ctx.plugin({
  name: "conn-provider",
  inject: ["webServer"],
  apply(c) { new HostConnectionService(c, []); },
});

// The consumer (mirrors my plugin's inject-callback body).
await ctx.plugin({
  name: "consumer",
  inject: ["connection"],
  apply(c) {
    c.effect(() => c.connection.rpc.handle("/dsh-page-preview", async (endpoint, payload) => {
      if (endpoint === "state") return { registration: null };
      return { ok: false };
    }, {}), "test rpc");
  },
});

const paths = routes.map((r) => r.path);
console.log("registered routes:", JSON.stringify(paths));
if (!paths.includes("/dsh-page-preview")) {
  console.error("FAIL: /dsh-page-preview route missing");
  process.exit(1);
}

// Exercise the route handler the way a browser client would.
const route = routes.find((r) => r.path === "/dsh-page-preview");
let status = 0;
const chunks = [];
const req = {
  method: "POST",
  url: "/dsh-page-preview/state",
  headers: { host: "127.0.0.1:3080", "content-type": "application/json" },
  [Symbol.asyncIterator]() {
    let sent = false;
    return {
      async next() {
        if (sent) return { done: true };
        sent = true;
        return { done: false, value: Buffer.from(JSON.stringify({
          type: "client-request",
          rpcId: "00000000-0000-4000-8000-000000000001",
          method: "state",
          payload: { sessionId: "probe" },
        })) };
      },
    };
  },
};
const res = {
  setHeader() {},
  writeHead(code) { status = code; },
  end(body) { if (body !== undefined) chunks.push(Buffer.from(body).toString("utf8")); },
  on() {},
  once() {},
  off() {},
  write(chunk) { chunks.push(Buffer.from(chunk).toString("utf8")); return true; },
  writableEnded: false,
};
await route.handler(req, res);
console.log("handler status:", status);
console.log("handler body:", chunks.join("").slice(0, 200));
if (status !== 200 || !chunks.join("").includes("server-response")) {
  console.error("FAIL: unexpected handler response");
  process.exit(1);
}
console.log("PASS: RPC channel registers and answers client envelopes");
process.exit(0);

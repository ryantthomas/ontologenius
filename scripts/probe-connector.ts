/** Drives the whole connector handshake the way claude.ai would. */
import { createHash, randomBytes } from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:3000";
const REDIRECT = "http://localhost:9999/callback";

const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

// 1. Dynamic client registration
const client = await (
  await fetch(`${BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "probe",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  })
).json();
console.log("1. registered client:", client.client_id ? "ok" : client);

// 2. Authorize -> redirect carrying the code
const authorize = new URL(`${BASE}/authorize`);
authorize.search = new URLSearchParams({
  client_id: client.client_id,
  response_type: "code",
  code_challenge: challenge,
  code_challenge_method: "S256",
  redirect_uri: REDIRECT,
  state: "probe-state",
}).toString();

const redirected = await fetch(authorize, { redirect: "manual" });
const location = new URL(redirected.headers.get("location")!);
const code = location.searchParams.get("code")!;
console.log("2. authorized:", redirected.status, "state preserved:", location.searchParams.get("state"));

// 3. Exchange the code, with PKCE
const tokens = await (
  await fetch(`${BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: client.client_id,
      redirect_uri: REDIRECT,
    }),
  })
).json();
console.log("3. exchanged:", tokens.access_token ? "got access + refresh token" : tokens);

// 3b. A replayed code must fail.
const replay = await fetch(`${BASE}/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: client.client_id,
    redirect_uri: REDIRECT,
  }),
});
console.log("3b. replayed code rejected:", replay.status !== 200);

// 4. Call the connector
const mcp = async (body: unknown, id: number) =>
  fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${tokens.access_token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, ...(body as object) }),
  });

const init = await mcp(
  {
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "probe", version: "0" },
    },
  },
  1,
);
console.log("4. initialize over HTTP:", init.status);

const list = await mcp({ method: "tools/list", params: {} }, 2);
const text = await list.text();
const tools = [...text.matchAll(/"name":"(\w+)"/g)].map((m) => m[1]);
console.log("5. tools/list:", list.status, tools.join(", "));

// 6b. Optionally exercise the backup endpoint. Off by default: probing a live
// deployment should not write to it unless that is what you asked for.
if (process.argv.includes("--backup")) {
  const backup = await fetch(`${BASE}/admin/backup`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const body = await backup.json();
  console.log("6b. live backup:", backup.status, JSON.stringify(body));
  if (!backup.ok) process.exitCode = 1;
}

// 6. A garbage token must not work.
const bad = await fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer forged.signature" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} }),
});
console.log("6. forged token rejected:", bad.status);

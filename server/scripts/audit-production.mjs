import { randomUUID, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";

// Bounded production checks: three temporary customers, at most 20 kobo in test wallets,
// concurrency at most six. Financial records remain; balances are restored before limits.
const base = process.env.AUDIT_BASE_URL ?? "https://walletintegration-6t6r.onrender.com";
if (new URL(base).protocol !== "https:") throw new Error("Production audit requires HTTPS");
const report = { startedAt: new Date().toISOString(), baseUrl: base, checks: [], samples: [], testUsers: [] };
const funderEmail = process.env.AUDIT_FUNDER_EMAIL ?? "ada@example.com";
const funderPassword = process.env.AUDIT_FUNDER_PASSWORD ?? "demo-password-2026";
let total = 0;
async function request(label, path, { token, body, headers = {}, method = body === undefined ? "GET" : "POST" } = {}) {
  if (++total > 450) throw new Error("Audit request budget exhausted");
  const started = performance.now();
  const response = await fetch(base + path, {
    method, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(35_000),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  const sample = { label, status: response.status, ms: Math.round(performance.now() - started),
    at: new Date().toISOString(), limit: response.headers.get("ratelimit-limit"), reset: response.headers.get("ratelimit-reset"),
    requestId: response.headers.get("x-request-id"), remaining: response.headers.get("ratelimit-remaining"),
    retryAfter: response.headers.get("retry-after"), code: data?.error?.code };
  report.samples.push(sample);
  return { ...sample, data, headers: response.headers };
}
async function check(name, work) {
  try { await work(); report.checks.push({ name, passed: true }); console.log("PASS", name); }
  catch (error) { report.checks.push({ name, passed: false, message: error.message }); console.log("FAIL", name, error.message); }
}
async function login(email, password) {
  const response = await request("login", "/auth/login", { body: { email, password } });
  assert.equal(response.status, 200, `login returned ${response.status}`);
  return response.data.token;
}
async function wallet(token) {
  const response = await request("wallet", "/wallets/me", { token });
  assert.equal(response.status, 200, `wallet returned ${response.status}`);
  return response.data;
}
async function transfer(token, source, destination, amount, key = randomUUID()) {
  for (let attempt = 0; ; attempt++) {
    const response = await request("transfer", "/transfers", { token,
      headers: { "Idempotency-Key": key }, body: {
        sourceWalletId: source.id, destinationWalletId: destination.id, currency: "NGN", amountMinor: String(amount),
      } });
    if (response.status !== 503 || attempt === 2) return response;
    await delay(1200);
  }
}
let funderToken, funderWallet, sourceToken, destinationToken, source, destination;
try {
  await check("liveness and readiness", async () => {
    assert.equal((await request("live", "/health/live")).status, 200);
    assert.equal((await request("ready", "/health/ready")).status, 200);
  });
  funderToken = await login(funderEmail, funderPassword);
  funderWallet = await wallet(funderToken);
  for (const label of ["source", "destination"]) {
    const email = `audit-${randomUUID()}@example.com`;
    const password = randomBytes(24).toString("base64url");
    const registration = await request("register", "/auth/register", { body: { email, name: "Production audit", password } });
    assert.equal(registration.status, 201, `registration returned ${registration.status}`);
    report.testUsers.push({ email, userId: registration.data.user.id, walletId: registration.data.wallet.id });
    const token = await login(email, password);
    if (label === "source") { sourceToken = token; source = await wallet(token); }
    else { destinationToken = token; destination = await wallet(token); }
  }
  await check("blacklist and privileged registration fields are rejected", async () => {
    assert.equal((await request("blacklist", "/auth/register", { body: {
      email: " FRAUDSTER@Example.com ", name: "Audit", password: "not-a-real-password",
    } })).status, 422);
    assert.equal((await request("privileged registration", "/auth/register", { body: {
      email: `audit-invalid-${randomUUID()}@example.com`, name: "Audit", password: "not-a-real-password", role: "admin",
    } })).status, 400);
  });
  const funded = await transfer(funderToken, funderWallet, source, 20);
  assert.equal(funded.status, 201, `funding returned ${funded.status}`);

  await check("six concurrent duplicates move exactly one kobo", async () => {
    const key = randomUUID();
    const responses = await Promise.all(Array.from({ length: 6 }, () => transfer(sourceToken, source, destination, 1, key)));
    assert(responses.every((response) => response.status === 201), "not all duplicates resolved to 201");
    assert.equal(new Set(responses.map((response) => response.data.transfer.id)).size, 1);
    assert.equal((await wallet(sourceToken)).balanceMinor, "19");
    assert.equal((await wallet(destinationToken)).balanceMinor, "1");
    assert.equal((await transfer(sourceToken, source, destination, 2, key)).status, 409);
  });
  await check("concurrent overspending never makes a balance negative", async () => {
    const responses = await Promise.all(Array.from({ length: 4 }, () => transfer(sourceToken, source, destination, 15)));
    assert.equal(responses.filter((response) => response.status === 201).length, 1);
    assert.equal(responses.filter((response) => response.status === 422).length, 3);
    assert.equal((await wallet(sourceToken)).balanceMinor, "4");
    assert.equal((await wallet(destinationToken)).balanceMinor, "16");
  });
  await check("opposite-direction transfers complete and conserve balances", async () => {
    const responses = await Promise.all([
      transfer(sourceToken, source, destination, 1), transfer(destinationToken, destination, source, 1),
    ]);
    assert(responses.every((response) => response.status === 201));
    assert.equal((await wallet(sourceToken)).balanceMinor, "4");
    assert.equal((await wallet(destinationToken)).balanceMinor, "16");
  });
  await check("ownership and admin access are enforced", async () => {
    assert.equal((await transfer(destinationToken, source, destination, 1)).status, 403);
    assert.equal((await request("admin denied", "/admin/audit", { token: sourceToken })).status, 403);
    const history = await request("foreign history", `/transfers/${funded.data.transfer.id}`, { token: destinationToken });
    assert.equal(history.status, 404);
  });
  await check("out-of-range IDs are rejected without a server error", async () => {
    for (const id of ["9223372036854775808", "0", "-1", "1%20OR%201%3D1"]) {
      assert.equal((await request("invalid id", `/transfers/${id}`, { token: sourceToken })).status, 404);
    }
  });
  await check("authenticated reads are not cacheable", async () => {
    const response = await request("cache headers", "/wallets/me", { token: sourceToken });
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  });
  await check("read burst at concurrency six stays available", async () => {
    for (let batch = 0; batch < 5; batch++) {
      const responses = await Promise.all(Array.from({ length: 6 }, () => request("read burst", "/wallets/me", { token: sourceToken })));
      assert(responses.every((response) => response.status === 200), "read burst returned a non-200");
    }
  });
} catch (error) {
  report.checks.push({ name: "audit setup/execution", passed: false, message: error.message });
} finally {
  // Returning money is a new compensating transfer, never a ledger edit or delete.
  await check("restore test and funder balances", async () => {
    if (!sourceToken || !destinationToken || !funderToken || !funderWallet) throw new Error("Setup incomplete; inspect recorded test users");
    for (const [token, account] of [[sourceToken, source], [destinationToken, destination]]) {
      const current = await wallet(token);
      if (BigInt(current.balanceMinor) > 0n) {
        assert.equal((await transfer(token, account, funderWallet, current.balanceMinor)).status, 201);
      }
      assert.equal((await wallet(token)).balanceMinor, "0");
    }
    assert.equal((await wallet(funderToken)).balanceMinor, funderWallet.balanceMinor, "funder balance differs; check concurrent external activity");
  });
  if (sourceToken && destinationToken) {
    await check("transfer limiter returns 429 and Retry-After", async () => {
      let limited;
      for (let count = 0; count < 62; count++) {
        const response = await request("transfer limit", "/transfers", { token: sourceToken, body: {} });
        if (response.status === 429) { limited = response; break; }
        assert.equal(response.status, 400);
      }
      assert(limited, "no 429 after exceeding transfer quota");
      assert(Number(limited.retryAfter) > 0);
      assert.notEqual((await request("other account transfer quota", "/transfers", { token: destinationToken, body: {} })).status, 429);
    });
    await check("read limiter is shared across read routes and isolated by account", async () => {
      // A fresh zero-balance account starts its read window here. Reusing a bucket opened
      // during setup could cross its reset boundary and incorrectly report a broken limit.
      const email = `audit-read-${randomUUID()}@example.com`;
      const password = randomBytes(24).toString("base64url");
      const registered = await request("register read probe", "/auth/register", { body: { email, name: "Read quota audit", password } });
      assert.equal(registered.status, 201);
      report.testUsers.push({ email, userId: registered.data.user.id, walletId: registered.data.wallet.id });
      const readToken = await login(email, password);
      const began = performance.now();
      let limited;
      for (let count = 0; count < 41; count++) {
        // Invalid pagination reaches the read limiter without running a database query.
        const responses = await Promise.all(Array.from({ length: 6 }, () => request("read limit", "/transfers?limit=0", { token: readToken })));
        assert(responses.every((response) => [400, 429].includes(response.status)));
        limited = responses.find((response) => response.status === 429);
        if (limited) break;
      }
      assert(performance.now() - began < 60_000, "inconclusive: quota probe crossed its window");
      assert(limited, "no 429 after exceeding read quota");
      assert(Number(limited.retryAfter) > 0);
      assert.equal((await request("shared read quota", "/wallets/me", { token: readToken })).status, 429);
      assert.equal((await request("other account read quota", "/wallets/me", { token: destinationToken })).status, 200);
    });
    await check("auth IP quota cannot be bypassed by rotating forwarded headers", async () => {
      let limited;
      for (let count = 0; count < 25; count++) {
        const response = await request("auth limit", "/auth/login", { body: {} });
        if (response.status === 429) { limited = response; break; }
        assert.equal(response.status, 400);
      }
      assert(limited, "no 429 after exceeding auth quota");
      for (let count = 0; count < 5; count++) {
        assert.equal((await request("forwarded spoof", "/auth/login", {
          body: {}, headers: { "X-Forwarded-For": `198.51.100.${count + 1}` },
        })).status, 429);
      }
    });
  }
  report.finishedAt = new Date().toISOString();
  report.totalRequests = total;
  const durations = report.samples.filter((sample) => sample.label === "read burst").map((sample) => sample.ms).sort((a, b) => a - b);
  report.readBurst = { count: durations.length, p50Ms: durations[Math.floor(durations.length * 0.5)], p95Ms: durations[Math.floor(durations.length * 0.95)], maxMs: durations.at(-1) };
  const path = process.env.AUDIT_REPORT_PATH ?? "production-audit.json";
  await writeFile(path, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ totalRequests: total, readBurst: report.readBurst, checks: report.checks }));
  if (report.checks.some((result) => !result.passed)) process.exitCode = 1;
}

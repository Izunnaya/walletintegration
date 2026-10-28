import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  databaseIdSchema,
  registrationPasswordSchema,
} from "../src/lib/validation";
import { money, toMinor } from "../src/lib/money";

test("money and wallet IDs retain precision beyond JavaScript numbers", () => {
  expect(toMinor("90,071,992,547,409.93")).toBe("9007199254740993");
  expect(money("9007199254740993")).toContain("90,071,992,547,409.93");
  expect(databaseIdSchema.parse("9007199254740993")).toBe("9007199254740993");
  expect(databaseIdSchema.safeParse("9223372036854775808").success).toBe(false);
});

test("registration enforces the server's UTF-8 password byte limit", () => {
  expect(registrationPasswordSchema.safeParse("a".repeat(72)).success).toBe(
    true,
  );
  expect(
    registrationPasswordSchema.safeParse("\u00e9".repeat(37)).success,
  ).toBe(false);
  expect(registrationPasswordSchema.safeParse(" ".repeat(12)).success).toBe(
    false,
  );
});

const sourcePublicId = "wlt_" + "a".repeat(32);
const destinationPublicId = "wlt_" + "b".repeat(32);
const createdAt = "2026-10-28T10:00:00.000Z";
const transfer = (id = "30") => ({
  id,
  reference: `reference-${id}`,
  sourceWalletId: "111",
  destinationWalletId: "222",
  sourceWalletPublicId: sourcePublicId,
  destinationWalletPublicId: destinationPublicId,
  amountMinor: "150050",
  currency: "NGN",
  createdAt,
});
const customer = {
  id: "1",
  name: "Ada Okafor",
  email: "ada@example.com",
  role: "customer",
};

async function setupApi(page: Page, role: "customer" | "admin" = "customer") {
  const state = {
    requests: [] as {
      path: string;
      method: string;
      authorization: string | undefined;
    }[],
    transfers: [] as {
      body: Record<string, unknown>;
      key: string | undefined;
    }[],
    restrictions: [] as { path: string; body: unknown }[],
    failure: 0,
    loginFailure: false,
    invalidLogin: false,
    walletError: false,
  };
  await page.route("http://127.0.0.1:4010/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    state.requests.push({
      path: path + url.search,
      method: request.method(),
      authorization: request.headers().authorization,
    });
    const json = (
      body: unknown,
      status = 200,
      extraHeaders: Record<string, string> = {},
    ) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "Retry-After,X-Request-Id",
          "X-Request-Id": "test-request",
          ...extraHeaders,
        },
        body: JSON.stringify(body),
      });
    if (path === "/health/live") return json({ status: "ok" });
    if (path === "/health/ready") return json({ status: "ready" });
    if (path === "/auth/login") {
      if (state.invalidLogin) {
        return json(
          {
            error: {
              code: "INVALID_CREDENTIALS",
              message: "Invalid email or password.",
              requestId: "login-error",
            },
          },
          401,
        );
      }
      if (state.loginFailure) {
        state.loginFailure = false;
        return json(
          { error: { code: "RATE_LIMITED", message: "Try again shortly" } },
          429,
          { "Retry-After": "2" },
        );
      }
      const body: { email: string; password: string } = request.postDataJSON();
      const user =
        body.email === "bode@example.com"
          ? { ...customer, id: "2", name: "Bode Adeyemi", email: body.email }
          : { ...customer, role };
      return json({ token: `test-token-${user.id}`, user });
    }
    if (path === "/auth/register") {
      const body: { name: string; email: string } = request.postDataJSON();
      return json(
        {
          user: { ...customer, name: body.name, email: body.email },
          wallet: {
            id: "333",
            publicId: "wlt_" + "c".repeat(32),
            currency: "NGN",
            balanceMinor: "0",
          },
        },
        201,
      );
    }
    if (!request.headers().authorization)
      return json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Sign in",
            requestId: "test-request",
          },
        },
        401,
      );
    if (path === "/wallets/me") {
      if (state.walletError)
        return json(
          {
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "Database unavailable",
              requestId: "wallet-error",
            },
          },
          503,
        );
      const second = request.headers().authorization === "Bearer test-token-2";
      return json({
        id: second ? "222" : "111",
        publicId: second ? destinationPublicId : sourcePublicId,
        currency: "NGN",
        balanceMinor: second ? "0" : "50000000",
      });
    }
    if (path === "/transfers" && request.method() === "GET") {
      return json(
        url.searchParams.has("cursor")
          ? {
              transfers: [{ ...transfer("29"), direction: "sent" }],
              nextCursor: null,
            }
          : {
              transfers: [{ ...transfer(), direction: "sent" }],
              nextCursor: "30",
            },
      );
    }
    if (path.startsWith("/transfers/"))
      return json({
        transfer: { ...transfer(path.split("/").at(-1)), direction: "sent" },
      });
    if (path === "/transfers" && request.method() === "POST") {
      state.transfers.push({
        body: request.postDataJSON(),
        key: request.headers()["idempotency-key"],
      });
      if (state.failure) {
        const status = state.failure;
        state.failure = 0;
        if (status === -1) return route.abort("failed");
        return json(
          {
            error: {
              code:
                status === 422
                  ? "INSUFFICIENT_FUNDS"
                  : status === 401
                    ? "TOKEN_EXPIRED"
                    : status === 429
                      ? "RATE_LIMITED"
                      : "TRANSFER_UNAVAILABLE",
              message: "Test transfer response",
              requestId: "transfer-error",
            },
          },
          status,
          { "Retry-After": "1" },
        );
      }
      return json({ transfer: transfer() }, 201);
    }
    if (path === "/admin/audit")
      return json({
        entries: [
          {
            id: "1",
            action: "block",
            reason: "Account review",
            createdAt,
            actor: { id: "1", email: "admin@example.com" },
            affected: { id: "2", email: "bode@example.com" },
          },
        ],
      });
    if (path.startsWith("/admin/users/")) {
      state.restrictions.push({ path, body: request.postDataJSON() });
      return json({
        user: {
          ...customer,
          id: "2",
          name: "Bode Adeyemi",
          email: "bode@example.com",
          isBlocked: path.endsWith("/block"),
        },
        changed: true,
      });
    }
    throw new Error(`Unexpected API request: ${request.method()} ${path}`);
  });
  return state;
}

async function login(page: Page, email = "ada@example.com") {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct horse battery staple");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Hello,/ })).toBeVisible();
}
async function reviewTransfer(page: Page) {
  await page
    .getByRole("link", { name: "Send money", exact: true })
    .first()
    .click();
  await page.getByLabel("Recipient wallet ID").fill(destinationPublicId);
  await page.getByLabel("Amount (NGN)").fill("1,500.50");
  await page.getByRole("button", { name: "Review transfer" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(destinationPublicId);
}

test("sign-in uses real API shapes and shows only supported customer controls", async ({
  page,
}) => {
  const state = await setupApi(page);
  await page.goto("/transfer");
  await expect(page).toHaveURL(/\/login/);
  await login(page);
  await expect(page.getByText("Ada Okafor", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Account access" })).toHaveCount(
    0,
  );
  await expect(page.getByText("Preview role")).toHaveCount(0);
  await expect(page.getByText("THIS MONTH")).toHaveCount(0);
  expect(
    state.requests.find((request) => request.path === "/wallets/me")
      ?.authorization,
  ).toBe("Bearer test-token-1");
  await page.goto("/admin/access");
  await expect(page).toHaveURL(/\/$/);
  expect(
    state.requests.filter((request) => request.path.startsWith("/admin")),
  ).toHaveLength(0);
});

test("failed login shows a clear message without internal request IDs", async ({
  page,
}) => {
  const state = await setupApi(page);
  state.invalidLogin = true;
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("ada@example.com");
  await page.getByLabel("Password", { exact: true }).fill("wrong password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Invalid email or password.",
  );
  await expect(
    page.getByText(/login-error|test-request|Request ID:/),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/\/login$/);
  state.invalidLogin = false;
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct horse battery staple");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Hello,/ })).toBeVisible();
});

test("public registration creates a customer and returns to sign-in", async ({
  page,
}) => {
  await setupApi(page);
  await page.goto("/register");
  await page.getByLabel("Name", { exact: true }).fill("New Customer");
  await page.getByLabel("Email", { exact: true }).fill("new@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct horse battery staple");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login\?registered=1/);
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "new@example.com",
  );
  await expect(
    page.getByText("Your account and wallet are ready.", { exact: false }),
  ).toBeVisible();
});

test("sign-in respects a rate limit before allowing another request", async ({
  page,
}) => {
  const state = await setupApi(page);
  state.loginFailure = true;
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("ada@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct horse battery staple");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: /Retry in/ })).toBeDisabled();
  expect(
    state.requests.filter((request) => request.path === "/auth/login"),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Hello,/ })).toBeVisible();
});

test("history uses backend cursors and a real transfer detail route", async ({
  page,
}) => {
  const state = await setupApi(page);
  await login(page);
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await page.getByRole("button", { name: "Load older transfers" }).click();
  await expect(
    page.getByRole("link", { name: "View transfer 29" }),
  ).toBeVisible();
  expect(
    state.requests.some((request) => request.path.includes("cursor=30")),
  ).toBe(true);
  await page.getByRole("link", { name: "View transfer 29" }).click();
  await expect(page).toHaveURL(/\/transactions\/29$/);
  await expect(page.getByText("reference-29", { exact: true })).toBeVisible();
});

test("an interrupted transfer survives reload and reuses its exact key and body", async ({
  page,
}) => {
  const state = await setupApi(page);
  await login(page);
  state.failure = 503;
  await reviewTransfer(page);
  await page
    .getByRole("button", { name: "Confirm transfer", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Check transfer status|Retry in/ }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Resume transfer" }).click();
  await page
    .getByRole("button", { name: "Check transfer status", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Transfer completed" }),
  ).toBeVisible();
  expect(state.transfers).toHaveLength(2);
  expect(state.transfers[1]).toEqual(state.transfers[0]);
  expect(state.transfers[0].body).toEqual({
    sourceWalletId: sourcePublicId,
    destinationWalletId: destinationPublicId,
    amountMinor: "150050",
    currency: "NGN",
  });
});

test("a network failure preserves the attempt across navigation", async ({
  page,
}) => {
  const state = await setupApi(page);
  await login(page);
  state.failure = -1;
  await reviewTransfer(page);
  await page
    .getByRole("button", { name: "Confirm transfer", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Check transfer status" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page
    .getByRole("link", { name: "Send money", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Recipient wallet ID")).toBeDisabled();
  await page.getByRole("button", { name: "Resume transfer" }).click();
  await page.getByRole("button", { name: "Check transfer status" }).click();
  await expect(
    page.getByRole("heading", { name: "Transfer completed" }),
  ).toBeVisible();
  expect(state.transfers[1].key).toBe(state.transfers[0].key);
});

test("a known rejection allows a new intent with a fresh key", async ({
  page,
}) => {
  const state = await setupApi(page);
  await login(page);
  state.failure = 422;
  await reviewTransfer(page);
  await page
    .getByRole("button", { name: "Confirm transfer", exact: true })
    .click();
  await page.getByRole("button", { name: "Start a new transfer" }).click();
  await page.getByRole("button", { name: "Review transfer" }).click();
  await page
    .getByRole("button", { name: "Confirm transfer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Transfer completed" }),
  ).toBeVisible();
  expect(state.transfers[1].key).not.toBe(state.transfers[0].key);
});

test("429 honors Retry-After and preserves the same intent", async ({
  page,
}) => {
  const state = await setupApi(page);
  await login(page);
  state.failure = 429;
  await reviewTransfer(page);
  await page
    .getByRole("button", { name: "Confirm transfer", exact: true })
    .click();
  await expect(page.getByRole("button", { name: /Retry in/ })).toBeDisabled();
  expect(state.transfers).toHaveLength(1);
  await page
    .getByRole("button", { name: "Confirm transfer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Transfer completed" }),
  ).toBeVisible();
  expect(state.transfers[1].key).toBe(state.transfers[0].key);
});

test("session expiry preserves the pending transfer for the same user", async ({
  page,
}) => {
  const state = await setupApi(page);
  await login(page);
  state.failure = 401;
  await reviewTransfer(page);
  await page
    .getByRole("button", { name: "Confirm transfer", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login/);
  await login(page);
  await page
    .getByRole("link", { name: "Send money", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Resume transfer" }).click();
  await page.getByRole("button", { name: "Check transfer status" }).click();
  await expect(
    page.getByRole("heading", { name: "Transfer completed" }),
  ).toBeVisible();
  expect(state.transfers[1].key).toBe(state.transfers[0].key);
});

test("signing out clears cached wallet data and pending attempts stay scoped to their user", async ({
  page,
}) => {
  const state = await setupApi(page);
  await login(page);
  state.failure = -1;
  await reviewTransfer(page);
  await page
    .getByRole("button", { name: "Confirm transfer", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Check transfer status" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await login(page, "bode@example.com");
  await expect(
    page.getByRole("heading", { name: "Hello, Bode Adeyemi" }),
  ).toBeVisible();
  await expect(page.getByText("Ada Okafor", { exact: true })).toHaveCount(0);
  await page
    .getByRole("link", { name: "Send money", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Resume transfer" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Recipient wallet ID")).toBeEnabled();
  await page.getByRole("button", { name: "Sign out" }).click();
  await login(page);
  await page
    .getByRole("link", { name: "Send money", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Resume transfer" }),
  ).toBeVisible();
});

test("admin actions use user IDs and reasons and expose the real audit trail", async ({
  page,
}) => {
  const state = await setupApi(page, "admin");
  await login(page);
  await page.getByRole("link", { name: "Account access", exact: true }).click();
  await page.getByLabel("User ID", { exact: true }).fill("2");
  await page.getByLabel("Reason", { exact: true }).fill("Account review");
  await page.getByRole("button", { name: "Apply account restriction" }).click();
  await page.getByRole("button", { name: "Confirm change" }).click();
  await expect(
    page.getByText("Account updated.", { exact: false }),
  ).toBeVisible();
  expect(state.restrictions).toEqual([
    { path: "/admin/users/2/block", body: { reason: "Account review" } },
  ]);
  await page.getByRole("link", { name: "Audit log", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "admin@example.com", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Account review", exact: true }),
  ).toBeVisible();
});

test("server failures show a helpful message without internal IDs and allow a read retry", async ({
  page,
}) => {
  const state = await setupApi(page);
  state.walletError = true;
  await login(page);
  await expect(
    page.getByText("Database unavailable", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/wallet-error|Request ID:/)).toHaveCount(0);
  state.walletError = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("Wallet balance", { exact: true })).toBeVisible();
});

test("mobile navigation and the installed theme and motion providers work", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupApi(page);
  await login(page);
  await expect(
    page.getByRole("button", { name: "Sign out" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Dark mode", exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Dark mode", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign out" }),
  ).not.toBeVisible();
});

test("a saved numeric transfer remains recoverable after public IDs are introduced", async ({
  page,
}) => {
  const state = await setupApi(page);
  await login(page);
  await page.evaluate(() =>
    sessionStorage.setItem(
      "wallet.transfer:1",
      JSON.stringify({
        sourceWalletId: "111",
        destinationWalletId: "222",
        amountMinor: "150050",
        idempotencyKey: "b5b5de03-865a-4ae5-bc54-bf227b731f15",
        phase: "unconfirmed",
        retryAt: 0,
      }),
    ),
  );
  await page.goto("/transfer");
  await page.getByRole("button", { name: "Resume transfer" }).click();
  await page.getByRole("button", { name: "Check transfer status" }).click();
  await expect(
    page.getByRole("heading", { name: "Transfer completed" }),
  ).toBeVisible();
  expect(state.transfers[0].body).toMatchObject({
    sourceWalletId: "111",
    destinationWalletId: "222",
  });
  expect(state.transfers[0].key).toBe("b5b5de03-865a-4ae5-bc54-bf227b731f15");
  await expect(
    page.getByText(destinationPublicId, { exact: true }),
  ).toBeVisible();
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import type { Server } from "node:http";
import { apiPrisma, prepareApiDatabase, closeApiDatabase, fundWallet } from "./apiDatabase.ts";
import { hashPassword } from "../src/models/password.ts";

vi.mock("../src/models/db.ts", async () => {
  const { apiPrisma, apiSchema } = await import("./apiDatabase.ts");
  return { prisma: apiPrisma, databaseSchema: apiSchema };
});
vi.hoisted(() => {
  process.env.JWT_SECRET = "history-integration-test-secret-not-for-production";
});
import app from "../src/app.ts";

let server: Server | undefined;
let baseUrl: string;

const password = "correct horse battery staple";

type Party = { userId: bigint; walletId: bigint; token: string };

let ada: Party;
let bode: Party;
let systemWalletId: bigint;
const references: string[] = [];

async function createParty(email: string, isSystem = false): Promise<Party> {
  const user = await apiPrisma.user.create({
    data: { email, name: email, passwordHash: await hashPassword(password), role: "customer" },
  });

  const wallet = await apiPrisma.wallet.create({ data: { ownerId: user.id, isSystem } });

  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const body = (await response.json()) as { token?: string };
  return { userId: user.id, walletId: wallet.id, token: body.token ?? "" };
}

function get(path: string, token: string) {
  return fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

beforeAll(async () => {
  await prepareApiDatabase();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const funder = await createParty("funder@example.com", true);
  systemWalletId = funder.walletId;
  ada = await createParty("ada@example.com");
  bode = await createParty("bode@example.com");

  // Five transfers into Ada and two out of her, so direction and ordering both have
  // something to be wrong about.
  for (let index = 0; index < 5; index += 1) {
    const reference = `in-${index}`;
    references.push(reference);
    await fundWallet(ada.walletId, systemWalletId, 100000n, reference);
  }
  for (let index = 0; index < 2; index += 1) {
    const reference = `out-${index}`;
    references.push(reference);
    await fundWallet(bode.walletId, ada.walletId, 1000n, reference);
  }
});

afterAll(async () => {
  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
  } finally {
    await closeApiDatabase();
  }
});

describe("GET /transfers", () => {
  it("returns only transfers the caller is a party to", async () => {
    const response = await get("/transfers?limit=100", ada.token);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { transfers: { reference: string }[] };
    // Ada is party to all seven: five in, two out. Bode is party to only the two out.
    expect(body.transfers).toHaveLength(7);

    const bodeResponse = await get("/transfers?limit=100", bode.token);
    const bodeBody = (await bodeResponse.json()) as { transfers: { reference: string }[] };
    expect(bodeBody.transfers.map((transfer) => transfer.reference).sort()).toEqual([
      "out-0",
      "out-1",
    ]);
  });

  it("reports direction from the caller's side of the transfer", async () => {
    const response = await get("/transfers?limit=100", ada.token);
    const body = (await response.json()) as { transfers: { reference: string; direction: string }[] };

    const byReference = new Map(body.transfers.map((t) => [t.reference, t.direction]));
    expect(byReference.get("in-0")).toBe("received");
    expect(byReference.get("out-0")).toBe("sent");

    // The same row, read by the other party, reports the opposite direction.
    const bodeResponse = await get("/transfers?limit=100", bode.token);
    const bodeBody = (await bodeResponse.json()) as { transfers: { reference: string; direction: string }[] };
    expect(bodeBody.transfers.find((t) => t.reference === "out-0")?.direction).toBe("received");
  });

  it("returns newest first", async () => {
    const response = await get("/transfers?limit=100", ada.token);
    const body = (await response.json()) as { transfers: { id: string }[] };

    const ids = body.transfers.map((transfer) => BigInt(transfer.id));
    const descending = [...ids].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
    expect(ids).toEqual(descending);
  });

  it("pages with a cursor, without repeating or skipping a row", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < 10; page += 1) {
      const query = cursor === null ? "/transfers?limit=3" : `/transfers?limit=3&cursor=${cursor}`;
      const response = await get(query, ada.token);
      const body = (await response.json()) as { transfers: { id: string }[]; nextCursor: string | null };

      expect(body.transfers.length).toBeLessThanOrEqual(3);
      seen.push(...body.transfers.map((transfer) => transfer.id));

      cursor = body.nextCursor;
      if (cursor === null) break;
    }

    // Every row exactly once: seven transfers over three pages.
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it("keeps paging correct when a transfer is written mid-read", async () => {
    // This is the reason for keyset pagination rather than OFFSET. With OFFSET, inserting a
    // newer row between two pages shifts everything down and the second page repeats a row.
    const first = await get("/transfers?limit=3", ada.token);
    const firstBody = (await first.json()) as { transfers: { id: string }[]; nextCursor: string | null };

    await fundWallet(ada.walletId, systemWalletId, 500n, "written-mid-read");

    const second = await get(`/transfers?limit=3&cursor=${firstBody.nextCursor}`, ada.token);
    const secondBody = (await second.json()) as { transfers: { id: string }[] };

    const overlap = secondBody.transfers.filter((transfer) =>
      firstBody.transfers.some((seen) => seen.id === transfer.id),
    );
    expect(overlap).toEqual([]);
  });

  it("returns an empty page rather than an error for a caller with no wallet", async () => {
    const user = await apiPrisma.user.create({
      data: {
        email: "walletless@example.com",
        name: "Walletless",
        passwordHash: await hashPassword(password),
        role: "customer",
      },
    });
    expect(user.id).toBeDefined();

    const login = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "walletless@example.com", password }),
    });
    const { token } = (await login.json()) as { token: string };

    const response = await get("/transfers", token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ transfers: [], nextCursor: null });
  });

  it("refuses a limit outside the allowed range, and an unknown query parameter", async () => {
    for (const query of ["/transfers?limit=0", "/transfers?limit=101", "/transfers?limit=abc", "/transfers?userId=1"]) {
      const response = await get(query, ada.token);
      expect(response.status, query).toBe(400);
    }
  });

  it("refuses a cursor that is not a transfer id", async () => {
    for (const cursor of ["-1", "0", "abc", "9223372036854775808"]) {
      const response = await get(`/transfers?cursor=${cursor}`, ada.token);
      expect(response.status, cursor).toBe(400);
    }
  });

  it("requires a token", async () => {
    const response = await fetch(`${baseUrl}/transfers`);
    expect(response.status).toBe(401);
  });
});

describe("GET /transfers/:id", () => {
  it("returns a transfer the caller sent or received", async () => {
    const list = await get("/transfers?limit=1", ada.token);
    const { transfers } = (await list.json()) as { transfers: { id: string }[] };
    const id = transfers[0]?.id ?? "";

    const response = await get(`/transfers/${id}`, ada.token);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ transfer: { id } });
  });

  it("answers 404, not 403, for a transfer belonging to someone else", async () => {
    // in-0 is between the funding wallet and Ada. Bode is party to neither side.
    const adaList = await get("/transfers?limit=100", ada.token);
    const { transfers } = (await adaList.json()) as { transfers: { id: string; reference: string }[] };
    const foreign = transfers.find((transfer) => transfer.reference === "in-0");
    expect(foreign).toBeDefined();

    const response = await get(`/transfers/${foreign?.id}`, bode.token);

    // 403 would confirm the id is real, which is a way of enumerating other people's
    // transfers. The body must be identical to a genuinely missing one.
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "TRANSFER_NOT_FOUND" } });
  });

  it("answers 404 for an id that does not exist, and for one that is not an id at all", async () => {
    for (const id of ["999999999", "abc", "-1", "1.5"]) {
      const response = await get(`/transfers/${id}`, ada.token);
      expect(response.status, id).toBe(404);
    }
  });

  it("requires a token", async () => {
    const response = await fetch(`${baseUrl}/transfers/1`);
    expect(response.status).toBe(401);
  });
});

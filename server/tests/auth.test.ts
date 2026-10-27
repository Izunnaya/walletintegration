import "dotenv/config";
import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { loginRequestSchema, registerRequestSchema } from "../src/domain/authRequest.ts";
import { issueToken, readToken } from "../src/models/authToken.ts";
import { hashPassword, verifyPassword } from "../src/models/password.ts";

const validRegistration = {
  email: "ada@example.com",
  name: "Ada Okafor",
  password: "correct horse battery staple",
};

const messagesOf = (body: unknown): string[] => {
  const result = registerRequestSchema.safeParse(body);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe("registerRequestSchema", () => {
  it("normalises the email by trimming and lowercasing", () => {
    const result = registerRequestSchema.safeParse({
      ...validRegistration,
      email: "  ADA@Example.COM  ",
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.email).toBe("ada@example.com");
  });

  it("refuses the privileged fields rather than dropping them", () => {
    // Q17 settled as reject. A body carrying any of these is a client bug or an escalation
    // attempt; stripping it quietly would hide the first and teach nothing about the second.
    for (const field of ["role", "isBlocked", "balanceMinor", "isSystem"]) {
      const result = registerRequestSchema.safeParse({ ...validRegistration, [field]: "admin" });

      expect(result.success, `expected ${field} to be refused`).toBe(false);
      expect(messagesOf({ ...validRegistration, [field]: "admin" }).join(" ")).toMatch(
        /Unrecognized key/,
      );
    }
  });

  it("refuses an address that is not a valid email", () => {
    for (const email of ["", "   ", "ada", "ada@", "@example.com", "ada example.com"]) {
      expect(registerRequestSchema.safeParse({ ...validRegistration, email }).success).toBe(false);
    }
  });

  it("requires a password of at least twelve characters", () => {
    expect(messagesOf({ ...validRegistration, password: "short" })).toContain(
      "password must be at least 12 characters",
    );
    expect(
      registerRequestSchema.safeParse({ ...validRegistration, password: "a".repeat(12) }).success,
    ).toBe(true);
  });

  it("caps the password length, so a huge body cannot be fed to bcrypt", () => {
    expect(
      registerRequestSchema.safeParse({ ...validRegistration, password: "a".repeat(201) }).success,
    ).toBe(false);
  });

  it("requires a name", () => {
    expect(messagesOf({ ...validRegistration, name: "   " })).toContain("name is required");
  });
});

describe("loginRequestSchema", () => {
  it("normalises the email the same way registration does", () => {
    const result = loginRequestSchema.safeParse({
      email: " ADA@Example.COM ",
      password: "anything",
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.email).toBe("ada@example.com");
  });

  it("does not impose a password length, so it reveals nothing about ours", () => {
    // A "too short to be ours" rejection at login would be a hint about our password rules.
    expect(loginRequestSchema.safeParse({ email: "ada@example.com", password: "x" }).success).toBe(
      true,
    );
  });

  it("refuses an unknown field", () => {
    expect(
      loginRequestSchema.safeParse({
        email: "ada@example.com",
        password: "x",
        role: "admin",
      }).success,
    ).toBe(false);
  });
});

describe("password hashing", () => {
  it("verifies the correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("correct horse battery stapl", hash)).toBe(false);
  });

  it("produces a different hash for the same password, because the salt differs", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");

    // Equal hashes would mean no salt, which makes a rainbow table worth building.
    expect(first).not.toBe(second);
    expect(await verifyPassword("correct horse battery staple", second)).toBe(true);
  });

  it("stores the cost factor in the hash, so it can be raised without breaking old ones", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash.startsWith("$2b$12$")).toBe(true);
  });
});

describe("session tokens", () => {
  it("round-trips the caller", () => {
    const token = issueToken({ userId: 42n, role: "customer" });
    const result = readToken(token);

    expect(result.ok).toBe(true);
    expect(result.ok && result.caller).toEqual({ userId: 42n, role: "customer" });
  });

  it("keeps a user id that would not survive a JavaScript number", () => {
    // The id column is BIGINT. Carrying it as a string in the token and parsing back to
    // bigint keeps it exact past 2^53.
    const huge = 9007199254740993n;
    const result = readToken(issueToken({ userId: huge, role: "admin" }));

    expect(result.ok && result.caller.userId).toBe(huge);
  });

  it("refuses a token signed with a different secret", () => {
    const forged = jwt.sign({ sub: "1", role: "admin" }, "a".repeat(48), {
      algorithm: "HS256",
      expiresIn: "1h",
    });

    expect(readToken(forged)).toEqual({ ok: false, reason: "INVALID" });
  });

  it("refuses an unsigned alg:none token", () => {
    // Pinning algorithms: ["HS256"] is what stops this. Without it some verifiers accept a
    // token that simply declares it needs no signature.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: "1", role: "admin", exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString("base64url");

    expect(readToken(`${header}.${payload}.`)).toEqual({ ok: false, reason: "INVALID" });
  });

  it("refuses a tampered signature", () => {
    const token = issueToken({ userId: 1n, role: "customer" });
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    expect(readToken(tampered)).toEqual({ ok: false, reason: "INVALID" });
  });

  it("reports an expired token separately, so a client knows to refresh", () => {
    const secret = process.env.JWT_SECRET ?? "";
    const expired = jwt.sign({ sub: "1", role: "customer" }, secret, {
      algorithm: "HS256",
      expiresIn: "-1s",
    });

    expect(readToken(expired)).toEqual({ ok: false, reason: "EXPIRED" });
  });

  it("refuses a token whose claims are the wrong shape", () => {
    const secret = process.env.JWT_SECRET ?? "";

    for (const claims of [
      { sub: "not-a-number", role: "customer" },
      { sub: "1", role: "superuser" },
      { sub: "1" },
      { role: "admin" },
    ]) {
      const token = jwt.sign(claims, secret, { algorithm: "HS256", expiresIn: "1h" });
      expect(readToken(token), `claims ${JSON.stringify(claims)}`).toEqual({
        ok: false,
        reason: "INVALID",
      });
    }
  });

  it("refuses rubbish that is not a token at all", () => {
    for (const value of ["", "abc", "a.b.c", "Bearer x"]) {
      expect(readToken(value)).toEqual({ ok: false, reason: "INVALID" });
    }
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("proxy configuration", () => {
  it("trusts no forwarded header on a direct local connection", async () => {
    vi.stubEnv("RENDER", ""); vi.stubEnv("TRUST_PROXY_HOPS", undefined);
    expect((await import("../src/proxyConfig.ts")).trustedProxyHops).toBe(0);
  });
  it("starts safely on Render without a new configuration variable", async () => {
    vi.stubEnv("RENDER", "true"); vi.stubEnv("TRUST_PROXY_HOPS", undefined);
    expect((await import("../src/proxyConfig.ts")).trustedProxyHops).toBe(0);
  });
  it.each(["", " "])("treats an empty Render setting %j as unconfigured", async (hops) => {
    vi.stubEnv("RENDER", "true"); vi.stubEnv("TRUST_PROXY_HOPS", hops);
    expect((await import("../src/proxyConfig.ts")).trustedProxyHops).toBe(0);
  });
  it.each(["true", "-1", "1.5", "11"])("rejects invalid hop count %s", async (hops) => {
    vi.stubEnv("RENDER", ""); vi.stubEnv("TRUST_PROXY_HOPS", hops);
    await expect(import("../src/proxyConfig.ts")).rejects.toThrow();
  });
  it("accepts an explicit two-proxy deployment", async () => {
    vi.stubEnv("RENDER", "true"); vi.stubEnv("TRUST_PROXY_HOPS", "2");
    expect((await import("../src/proxyConfig.ts")).trustedProxyHops).toBe(2);
  });
});

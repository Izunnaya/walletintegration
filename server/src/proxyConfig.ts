import { z } from "zod";

// A hop count is a deployment topology setting, not a guess based on forwarded headers.
if (process.env.RENDER === "true" && process.env.TRUST_PROXY_HOPS === undefined) {
  throw new Error("Set TRUST_PROXY_HOPS from the observed Render proxy chain before deploying.");
}
export const trustedProxyHops = z.string().regex(/^(?:[0-9]|10)$/, "TRUST_PROXY_HOPS must be an integer from 0 to 10")
  .transform(Number)
  .parse(process.env.TRUST_PROXY_HOPS ?? "0");

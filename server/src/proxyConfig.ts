import { z } from "zod";

// Unconfigured deployments trust only the socket peer. Proxy tuning must not stop startup.
const configuredHops = process.env.TRUST_PROXY_HOPS?.trim();
export const trustedProxyHops = z.string().regex(/^(?:[0-9]|10)$/, "TRUST_PROXY_HOPS must be an integer from 0 to 10")
  .transform(Number)
  .parse(configuredHops || "0");

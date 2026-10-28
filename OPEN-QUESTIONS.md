# Open questions

Questions raised while building, numbered in one sequence with
[DECISIONS.md](DECISIONS.md) — a question keeps its number when it is answered
and moves there, with the reasoning that settled it.

Each entry says what is being asked, why it matters, what the options cost, and
what it blocks. Nothing here is decided. Where a recommendation appears it is
marked as one.

The build spec's own instruction is to make the simplest call, record it, and
keep going. These are the ones where the simplest call is not obvious, or where
guessing would be expensive to undo.
---

## Q32 — How many proxy hops should `trust proxy` trust on Render?

**The rate limiter does not limit anybody on the deployed service, and the headers it
returns look correct while it happens.**

`app.set("trust proxy", 1)` is wrong for Render's forwarded header, and the comment next to
it describes the bug it actually has rather than the one it prevents.

**The evidence.** Express counts `trust proxy` hops from the right, so `1` means "the socket
peer is a trusted proxy, take the last `X-Forwarded-For` entry". Measured locally against
the real setting:

| `X-Forwarded-For` | `req.ip` |
| --- | --- |
| *(absent)* | `127.0.0.1` |
| `203.0.113.9` | `203.0.113.9` ← the caller |
| `203.0.113.9, 216.24.57.16` | `216.24.57.16` ← **the proxy** |
| `203.0.113.9, 198.51.100.4, 216.24.57.18` | `216.24.57.18` ← **the proxy** |

So the moment anything adds a second entry, `req.ip` is the platform, not the caller. On the
live service that is what happens: `authLimiter` is `limit: 20` per 60 seconds, and **60
requests in roughly 15 seconds all returned 401 with no 429**. The `RateLimit-Remaining`
counters came back non-monotonic — 19, 18, 17, then 19 again — which is several buckets keyed
by whichever Render edge address served the request, each with its own window. Render's
hostname resolves to more than one address.

It is **not** spoofable, which is the one thing the `1` was chosen for: sending a fabricated
`X-Forwarded-For` joined the existing bucket rather than creating a fresh one, so a caller
cannot mint themselves a new allowance. The failure is only in the hop count.

**Why it is not already fixed.** Every fix needs a number or a range that nobody should
guess:

- **`trust proxy: 2`** — correct if Render always adds exactly two entries. Silently wrong
  again the day it adds a third, and wrong in local development.
- **`trust proxy: true`** — takes the leftmost entry, which is the caller, and is
  caller-controlled. This trades a limiter that does not fire for one that can be bypassed
  on purpose. Worse.
- **A trust function matching Render's edge range** — correct and explicit, and needs the
  actual range.
- **Leave it and say so.** The limiter still refuses a sustained flood from the whole
  internet at 20 per minute per edge address, which is not nothing, and no caller can
  escape it. But it is not per-caller, which is what the code claims.

**What unblocks it:** the deployed logs now carry `req.ip`, `req.remoteAddress` and the raw
`forwardedFor` on every request line, specifically so the chain can be read rather than
guessed. One real request against the deployed service answers this, and then the hop count
is set with evidence.

**Recommended:** read the chain from the logs after the next deploy, then set the hop count
to match and add a test that pins it. Until then the limitation is recorded here rather than
described as working.

**What it blocks:** nothing else. The limiter is a protection, not a dependency, and the
money path does not use `req.ip`.

---

Everything else raised during the build has been answered and moved to
[DECISIONS.md](DECISIONS.md) with the reasoning that settled it.

That is a statement about questions, not about completeness: what is built and what is not is
in the README's "Where it stands" table.


Q32 production audit follow-up: 32 invalid login requests in a short parallel
burst returned fresh, non-monotonic counters for the same client. The caller
buckets still need the logged ingress chain to resolve. The new code exposes
TRUST_PROXY_HOPS, defaults all unconfigured deployments to zero, and warns on Render
without blocking startup. The IPv6 helper and a separate normalized-email login quota
mitigate additional bypasses, but do not establish the correct ingress hop count.
See docs/production-audit-2026-10-28.md.

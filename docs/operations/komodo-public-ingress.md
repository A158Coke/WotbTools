# Komodo public ingress (K2)

The Komodo control plane runs **privately** on Yecao (`deploy/komodo`): Core binds
only the WireGuard address `10.20.0.2:9120` and MongoDB publishes no host port.
This document covers the public ingress on top of it, which is owned entirely by
the TX Caddy gateway.

```text
Browser
   ↓
https://komodo.wotbtools.com
   ↓
TX Caddy  118.25.18.105:443
   ↓ WireGuard
10.20.0.2:9120
   ↓
Komodo Core（Yecao，私有）
```

## Ownership

| Concern | Owner |
| --- | --- |
| `komodo.wotbtools.com` DNS record | Komodo controller OpenTofu root (`infra/tofu/komodo`) |
| TLS certificate + public HTTP ingress | TX Caddy owner (`deploy/tx/Caddyfile`, `.github/workflows/caddy.yml`) |
| Komodo Core / MongoDB runtime, deployed release | Komodo controller owner (`deploy/komodo`, `.github/workflows/komodo-controller.yml`) |
| WireGuard transport | existing host/network ownership |

The boundaries are deliberate and enforced by contract tests:

- **Caddy never reads a Komodo release pin.** Caddy owns *"does public traffic
  reach the private Core correctly"*, not *"which Core release is deployed"*. That
  is why `deploy/komodo/**` is **not** a Caddy production input: a Komodo version
  bump must not re-run, or fail, the gateway by itself.
- **Komodo documentation is not Komodo production input.** This file lives under
  `docs/` precisely so a K2 docs change cannot trigger a Core/Mongo/DNS
  reconciliation through the Komodo controller path filter.

## Route

`deploy/tx/Caddyfile`:

```caddy
komodo.wotbtools.com {
	reverse_proxy 10.20.0.2:9120
}
```

The Host header is left untouched because `KOMODO_HOST` is already
`https://komodo.wotbtools.com`. Caddy obtains the certificate through its normal
automatic HTTPS flow; the DNS record already points at TX (`118.25.18.105`), so
no manual certificate work is needed. Nothing about Komodo is published on Yecao,
and no intermediate container proxies it.

## Verification

`.github/workflows/caddy.yml` proves the route in two layers, in this order, so a
failure is attributable:

1. **Private upstream (TX → WireGuard → Yecao).**
   `http://10.20.0.2:9120/version` must answer and report a semantic version
   (`^[0-9]+\.[0-9]+\.[0-9]+$`). Failure is reported as a
   **WireGuard / Yecao / Komodo Core** problem.
2. **Public route over trusted TLS.**
   `https://komodo.wotbtools.com/version` must return **exactly the value the
   private upstream reported**, and `https://komodo.wotbtools.com/` must answer.
   Failure is reported as a **Caddy / TLS / DNS** problem and the Caddy container
   log tail is printed.

Comparing public with private — instead of against a version constant — is the
durable Caddy invariant: Caddy does not need to know whether the deployed Core is
`2.3.3`, `2.4.0`, or anything else. `/version` is unauthenticated in Komodo 2.3.3,
so no admin credential is ever used, and TLS verification is never disabled
(`curl -k` / `--insecure` are forbidden by the contract test).

The retry budget is bounded inside the SSH step's `command_timeout: 30m`
(private 10 × 12 s, public 20 × 12 s, plus the pre-existing checks).

### Route inventory guard

`deploy/tx/validate-caddy-config.sh` runs before every staged Caddy promotion
(PR CI and production) and asserts the reviewed public site inventory:

- `wotbtools.com` → `wotb-frontend:80`
- `auth.wotbtools.com` → `keycloak:8080`
- `monitor.wotbtools.com` → `10.20.0.2:3000`
- `komodo.wotbtools.com` → `10.20.0.2:9120`
- `www.wotbtools.com` → permanent redirect to `https://wotbtools.com`
- the TX-local `/_wotb/ready` readiness surface still exists
- **no Yecao public address** anywhere, and no upstream outside the reviewed set

Only after that does it run the real `caddy validate` through the compose service
definition. PR CI (`ci-caddy.yml`) calls the identical entry point, so what the
pull request validates is what production stages. Local fixtures live in
`deploy/test-caddy-route-inventory.sh`.

The existing gateway checks (www/HTTP redirects, `/api/health`, Keycloak OIDC
discovery, `assetlinks.json`) keep their order and content, so a Komodo problem
can never mask a gateway regression.

## Manual acceptance

```sh
curl -fsS https://komodo.wotbtools.com/version   # the deployed Core release, e.g. 2.3.3
curl -fsSI https://komodo.wotbtools.com/         # successful HTTP response
```

Then open `https://komodo.wotbtools.com` and sign in as `admin` with the existing
`KOMODO_INIT_ADMIN_PASSWORD`. The admin password is never printed or stored in CI.

Expected Komodo inventory after the private bootstrap and this ingress:
Servers `0`, Stacks `0`, Deployments `0`, Procedures `0` — the controller plane
starts empty on purpose (see `deploy/komodo/README.md`).

## Failure semantics

| Situation | Behaviour |
| --- | --- |
| Core unreachable from TX | Caddy verification fails with a WireGuard/Yecao/Core message. No Komodo runtime is touched automatically |
| Core returns a non-semantic version | Same as above (the private layer requires a semantic version) |
| Public HTTPS up but reporting a different version | Caddy verification fails with a Caddy/TLS/DNS message plus the Caddy log tail |
| Public HTTPS fails after deploy | Workflow fails; private success never counts as public success |
| Caddy configuration invalid | `validate-caddy-config.sh` fails during staging, so the live gateway is not promoted |
| DNS unavailable | K2 never creates or mutates DNS; the record stays OpenTofu-owned |

## Rollback

Revert the K2 change: the next Caddy reconcile removes the site block. The DNS
record and the Komodo runtime are untouched, and the private Core keeps running —
`https://komodo.wotbtools.com` simply stops being served.

## Out of scope

Periphery, TX/Yecao server registration, Resource Sync, Stacks, Deployments,
Actions, Procedures, any workload migration, Komodo-managed Caddy or OpenTofu,
OIDC/SSO, and any Mongo/Komodo backup policy.

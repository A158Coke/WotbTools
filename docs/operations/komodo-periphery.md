# Komodo Periphery on Yecao (K3.1)

K3.1 installs the Komodo **Periphery** agent on Yecao as a repository-owned,
systemd-managed host agent, so Komodo Core can present the host as a Server.
Workload adoption (stacks, deployments, repos, builds, procedures) is a later
phase and is deliberately **not** part of this change.

```text
Yecao
  periphery                 systemd unit, owned by GitHub Actions
      |
      |  outbound WebSocket + Noise handshake
      v
  Komodo Core               http://10.20.0.2:9120  (WireGuard only)
      |
      v
  Komodo UI                 Servers → yecao → Online
```

## Ownership

| Concern | Owner |
| --- | --- |
| Periphery binary, config, keys, systemd unit | `.github/workflows/komodo-periphery.yml` + `deploy/periphery/**` |
| Komodo Core / MongoDB runtime and the deployed Core release | `.github/workflows/komodo-controller.yml` + `deploy/komodo/**` |
| Public HTTP ingress (`https://komodo.wotbtools.com`) | `.github/workflows/caddy.yml` (`deploy/tx/Caddyfile`) |
| DNS for the control plane | `infra/tofu/komodo` (Komodo controller owner) |
| Server communication and future workload orchestration | Komodo Core |

The boundaries are enforced by contract tests:

- `deploy/periphery/**` is the **only** input of the Periphery owner. A Periphery
  change triggers neither the Komodo Core/Mongo/DNS reconcile nor the Caddy
  gateway, and a Komodo Core upgrade never re-runs the Periphery install.
- GitHub Actions owns the Periphery systemd lifecycle. Komodo Core never installs,
  restarts, or manages the agent that talks to it, and this workflow never touches
  Core, Caddy, DNS, or the Komodo controller runtime.

## Binary pin

`deploy/periphery/periphery.release` is the single source of truth:

```text
PERIPHERY_VERSION=2.3.3
PERIPHERY_RELEASE_TAG=v2.3.3
PERIPHERY_ASSET=periphery-x86_64
PERIPHERY_SHA256=40b78f377626799afad8331246a501f077d4ebcfb6d9096894cf55b64f6dcf13
PERIPHERY_URL=https://github.com/moghtech/komodo/releases/download/v2.3.3/periphery-x86_64
```

The **runner** downloads that exact asset, verifies its SHA256, and stages only the
verified bytes. **Yecao never downloads a binary**: `install.sh` re-verifies the
staged artifact against the same manifest before installing it, and the host fails
closed if `uname -m` is not an x86_64 equivalent. Nothing in the workflow uses
`latest`, a floating tag, or an image.

## Installation layout

| Path | Content |
| --- | --- |
| `/usr/local/bin/periphery` | The pinned binary (root-owned, mode 0755, replaced atomically) |
| `/etc/komodo/periphery.config.toml` | Persistent config, copied verbatim from this repository (mode 0600) |
| `/etc/komodo/keys/periphery.key` | Persistent Periphery Noise identity (generated once by Periphery) |
| `/etc/komodo/keys/core.pub` | Pinned Core public key (written by Periphery on the first handshake) |
| `/etc/systemd/system/periphery.service` | Repository-owned systemd unit (mode 0644) |
| `/opt/periphery/incoming/<SHA>` | SHA-scoped staging root, removed by the workflow |

The unit runs in the root systemd context (the current host administration model),
starts after `network-online.target` and `docker.service`, restarts on failure, and
is enabled on boot:

```ini
ExecStart=/usr/local/bin/periphery --config-path /etc/komodo/periphery.config.toml
```

## Outbound only

The persistent config expresses exactly one connection mode:

```toml
root_directory = "/etc/komodo"
core_addresses = ["http://10.20.0.2:9120"]
connect_as = "yecao"
server_enabled = false
private_key = "file:/etc/komodo/keys/periphery.key"
core_public_keys = ["file:/etc/komodo/keys/core.pub"]
disable_terminals = false
disable_container_terminals = false
```

- Core is reached on the **private WireGuard address**. The public name
  (`https://komodo.wotbtools.com`), the Yecao public address, and any wildcard bind
  are forbidden and asserted absent in both the config and the staging contract.
- `server_enabled = false` means Periphery never opens its inbound port, so **no
  listener exists on `:8120`**. Production verification proves the absence at
  runtime, and the fixture proves the probe detects a deliberately bound port.
- No git provider, image registry, Komodo `[secrets]`, stack path override, or
  build infrastructure is configured. Those belong to later migration phases.

The config file is the Komodo v2.3.3 schema: the field is `core_addresses` (a
list), with `core_address` kept only as a legacy alias.

## Onboarding credential lifecycle

`KOMODO_YECAO_ONBOARDING_KEY` is a **one-time bootstrap credential**, never a
runtime dependency.

1. `install.sh` decides from the host state: if `/etc/komodo/keys/periphery.key`
   already exists as a real, non-empty, non-symlink file, onboarding is **not**
   required and the secret is neither read nor needed.
2. On first install it writes the secret to `/run/komodo/periphery-bootstrap.env`
   (tmpfs, mode 0600, root-owned). The unit loads it through
   `EnvironmentFile=-/run/komodo/periphery-bootstrap.env`; the leading `-` keeps the
   unit valid once the file is gone.
3. It waits (bounded) until Periphery has generated its persistent identity,
   pinned the Core public key, and holds a live outbound connection to Core.
4. It deletes the transient file and restarts Periphery **without** the credential,
   then verification proves the process environment contains no
   `PERIPHERY_ONBOARDING_KEY` and that the connection re-established purely from
   the persistent identity.

The credential is never written to the config, the unit, a persistent
`EnvironmentFile`, the repository, or a log. Periphery itself redacts it in the
startup config it logs (v2.3.3 `PeripheryConfig::sanitized`), and this workflow
never echoes it. After the first successful K3.1 run the operator may delete the
repository secret and disable the UI onboarding key without breaking future
reconciles.

## Recovery behaviour

| Situation | Behaviour |
| --- | --- |
| Identity present (every later reconcile or upgrade) | Binary/config/unit are reconciled from the staged source; the identity and Core trust anchor are **never** regenerated or overwritten |
| Identity missing + onboarding key available | One bootstrap onboarding, then the credential is removed |
| Identity missing + no onboarding key | **Fail closed** before any host mutation: no identity is generated, no re-onboarding, nothing installed |
| Onboarding never completes | Bounded wait, then fail closed with the unit status and journal tail; the transient credential file is removed |
| Symlinked/irregular `/etc/komodo`, keys, binary, unit, or staged path | Refused; the install never follows a link |
| Staged artifact SHA mismatch | Refused before installation |
| Another Yecao host mutation holds `/opt/wotb/.deploy.lock` | The reconcile aborts instead of racing it |
| Periphery down or Core unreachable | `verify.sh` fails the workflow with the observable reason; nothing auto-recreates the identity |

Re-running the workflow is always safe and idempotent: it validates the staging
root, takes the Yecao host lock, verifies the artifact, reconciles the
binary/config/unit, and re-runs the full verification.

## Production verification

`deploy/periphery/verify.sh` runs after every reconcile and checks, without any
Komodo credential:

1. `/usr/local/bin/periphery` SHA256 equals the pinned digest.
2. The binary reports the pinned version.
3. `systemctl is-enabled periphery` and `is-active periphery` both succeed.
4. `keys/periphery.key` and `keys/core.pub` exist, are non-empty, real, non-symlink.
5. An established outbound connection exists from the Periphery main PID to
   `10.20.0.2:9120` (bounded retries).
6. No listener exists on `:8120`.
7. The persistent config still declares `connect_as = "yecao"`, the private Core
   address, `server_enabled = false`, and `root_directory = "/etc/komodo"`.
8. No onboarding key is persisted in the config or the unit, and the transient
   `/run` file is gone.
9. `/proc/<MainPID>/environ` contains no `PERIPHERY_ONBOARDING_KEY` and the service
   is still active after the credential-free restart.
10. Docker is reachable for the container discovery Periphery performs
    (`/var/run/docker.sock` readable and writable, daemon answering, root context).

The Server's own `Online` status in the UI is confirmed manually after the merge,
because it is Core-side state and intentionally not probed with the admin API.

## Manual acceptance

```sh
systemctl is-enabled periphery && systemctl is-active periphery
/usr/local/bin/periphery --version          # 2.3.3
sha256sum /usr/local/bin/periphery          # 40b78f377626799afad8331246a501f077d4ebcfb6d9096894cf55b64f6dcf13
ss -ltn | grep -c ':8120' || true           # must print 0 / nothing
ls -l /etc/komodo/keys/periphery.key /etc/komodo/keys/core.pub
```

Then open `https://komodo.wotbtools.com` and confirm:

```text
Servers
└── yecao   Online
```

## Rollback

Stop and remove the agent; the host returns to its pre-K3.1 state:

```sh
systemctl disable --now periphery
rm -f /etc/systemd/system/periphery.service
systemctl daemon-reload
```

Removing `/usr/local/bin/periphery` and `/etc/komodo` is optional and deletes the
Server identity; keeping them lets a later reconcile reattach the same Server. The
Komodo Core/Mongo runtime, the public ingress, and DNS are untouched by either
choice, and the `yecao` Server entry can be deleted from the UI independently.

## Out of scope

TX1 onboarding, Business API / frontend / Keycloak / AI service migration, stacks,
deployments, repos, builds, procedures, actions, resource sync, automatic updates,
OIDC/SSO, registry or git credentials, Mongo backup changes, Komodo Core changes,
Caddy changes, and DNS changes.

# Komodo Periphery on Yecao, TX1 and TX2 (K3.1 + K3.2 + K3.3)

Komodo **Periphery** runs on each production host as a repository-owned,
systemd-managed agent, so Komodo Core can present those hosts as Servers. One
lifecycle implementation serves every host; the per-host differences are reviewed
data under `deploy/periphery/targets/<target>`. Workload adoption (stacks,
deployments, repos, builds, procedures) is a later phase and is deliberately
**not** part of this change.

```text
Yecao  periphery v2.3.3 ──┐
TX1    periphery v2.3.3 ──┼──>  Komodo Core  http://10.20.0.2:9120  (WireGuard only)
TX2    periphery v2.3.3 ──┘                 │
                                            v
                          Komodo UI → Servers → yecao OK / tx1 OK / tx2 OK
```

Every agent uses **Periphery v2.3.3**, connects **outbound only** to
`http://10.20.0.2:9120`, and never opens an inbound port.

| Phase | Host | State |
| --- | --- | --- |
| K3.1 | Yecao | complete and production-proven; its onboarding credential was deleted after success |
| K3.2 | TX1 | complete and production-proven; onboarding credential deleted, reconciles credential-free |
| K3.3 | TX2 | **onboarding implemented, not yet complete**: it still needs the production first-onboarding run, then credential deletion, then a credential-free second run |

TX2's WireGuard link (`10.20.0.3/24` → Core at `10.20.0.2`) was established **before**
this phase and is **not** owned or managed by the Periphery change; nothing here
touches `/etc/wireguard`.

## Ownership

| Concern | Owner |
| --- | --- |
| Periphery binary, config, keys, systemd unit, per-host profile | `.github/workflows/komodo-periphery.yml` + `deploy/periphery/**` |
| Komodo Core / MongoDB runtime and the deployed Core release | `.github/workflows/komodo-controller.yml` + `deploy/komodo/**` |
| Public HTTP ingress (`https://komodo.wotbtools.com`) | `.github/workflows/caddy.yml` (`deploy/tx/Caddyfile`) |
| DNS for the control plane | `infra/tofu/komodo` (Komodo controller owner) |
| Server communication and future workload orchestration | Komodo Core |

The boundaries are enforced by contract tests: `deploy/periphery/**` is the only
input of the Periphery owner, so a Periphery change triggers neither the Komodo
Core/Mongo/DNS reconcile nor the Caddy gateway, and a Core or gateway change never
re-runs the agent install. GitHub Actions owns each agent's systemd lifecycle;
Komodo Core never installs, restarts, or manages the agent that talks to it.

## One lifecycle, per-host profiles

`deploy/periphery/{lib,install,verify,reconcile,staging-root}.sh` are
target-agnostic. Everything host-specific lives in
`deploy/periphery/targets/<target>/`:

| Target | `connect_as` | Host mutation lock | Staging root | Privilege |
| --- | --- | --- | --- | --- |
| `yecao` | `yecao` | `/opt/wotb/.deploy.lock` | `/opt/periphery` | `root` (the SSH account is root) |
| `tx1` | `tx1` | `/opt/wotb-tx/.deploy.lock` | `/opt/wotb-tx/periphery` | `sudo` (non-interactive) |
| `tx2` | `tx2` | `/opt/wotb-tx2/.deploy.lock` | `/opt/wotb-tx2/periphery` | `sudo` (non-interactive) |

`target.env` is validated by the same `load_target_profile` code on the host and in
the workflow: the target name must match its directory, `connect_as` must equal the
target name, the roots must be absolute, and a profile that assigns a credential is
refused. `install.sh` additionally refuses, **before touching the host**, a staged
config whose `connect_as` is not this target's, so one host can never install
another host's Server identity.

Adding a host means adding one reviewed target directory and one workflow job
mirroring the existing ones — never a second lifecycle implementation; the contract
tests enumerate every reviewed target, so a new host cannot be added silently.
Filesystem paths are identical on all hosts on purpose: they are separate machines,
so `/etc/komodo` and `/usr/local/bin/periphery` are host-local.

## Host locks

Periphery mutates a host, so it serializes on **that host's existing** mutation lock
and never creates its own:

- **Yecao:** `/opt/wotb/.deploy.lock`, shared with `deploy/deploy.sh`,
  `observability.yml`, and `ai-service.yml`.
- **TX1:** `/opt/wotb-tx/.deploy.lock`, shared with Business API, Frontend, Caddy,
  and Alloy, so no two TX mutations can overlap.
- **TX2:** `/opt/wotb-tx2/.deploy.lock`, the host's own deploy-owned lock, so no two
  TX2 mutations can overlap.

The lock root and its lock file belong to the host's deploy owner, so the reconcile
**requires them to already exist** and fails closed if they do not. Creating the
file as root would leave a root-only lock that the host's own non-root deploy user
could no longer take. Each target's lock root is distinct, and the contract tests
assert that no two targets share one.

## Privilege model

- **Yecao** runs the reconcile directly as its (root) SSH account; the script
  asserts it is root.
- **TX1** and **TX2** do not assume root. The same generic `PERIPHERY_PRIVILEGE=sudo`
  path applies to both: `reconcile.sh` re-executes itself through
  **non-interactive sudo** (`sudo -n`) and requires that to be available, failing
  closed otherwise. Only the generic onboarding variable is preserved
  (`sudo --preserve-env=KOMODO_PERIPHERY_ONBOARDING_KEY`), so the credential travels
  in the environment — never in argv, on disk, or in a log. A deterministic `PATH`
  is set for the privileged half. There is no per-host sudo implementation.

## Binary pin

`deploy/periphery/periphery.release` is the single source of truth:

```text
PERIPHERY_VERSION=2.3.3
PERIPHERY_RELEASE_TAG=v2.3.3
PERIPHERY_ASSET=periphery-x86_64
PERIPHERY_SHA256=40b78f377626799afad8331246a501f077d4ebcfb6d9096894cf55b64f6dcf13
PERIPHERY_URL=https://github.com/moghtech/komodo/releases/download/v2.3.3/periphery-x86_64
```

Each workflow job downloads that exact asset, verifies its SHA256, and stages only
the verified bytes. **No target host downloads a binary**: `install.sh` re-verifies
the staged artifact against the same manifest, and a host fails closed if
`uname -m` is not an x86_64 equivalent. Nothing uses `latest`, a floating tag, or an
image.

## Installation layout (host-local, identical on both hosts)

| Path | Content |
| --- | --- |
| `/usr/local/bin/periphery` | The pinned binary (root-owned, mode 0755, replaced atomically) |
| `/etc/komodo/periphery.config.toml` | Persistent config, copied verbatim from the target directory (mode 0600) |
| `/etc/komodo/keys/periphery.key` | Persistent Periphery Noise identity (generated by Periphery during startup) |
| `/etc/komodo/keys/core.pub` | Pinned Core public key (written by Periphery on the first successful handshake) |
| `/etc/komodo/keys/onboarding-complete` | Durable onboarding commit marker: `komodo-periphery-onboarding-v1`, root-owned, mode 0600 |
| `/etc/systemd/system/periphery.service` | Repository-owned systemd unit (mode 0644) |
| `<staging root>/incoming/<SHA>` | SHA-scoped staging root, removed by the workflow |

**The identity file is not proof of onboarding.** Periphery v2.3.3 initialises
`periphery_keys().load()` during startup, so `keys/periphery.key` is generated
**before** Server onboarding can have succeeded — a first attempt that fails still
leaves an identity behind. Only the marker, together with a valid identity and a
valid `core.pub`, means the bootstrap credential is no longer needed.

The shared unit starts after `network-online.target` and `docker.service`, restarts
on failure, is enabled on boot, runs in the root systemd context, and reads the
transient credential through `EnvironmentFile=-/run/komodo/periphery-bootstrap.env`:

```ini
ExecStart=/usr/local/bin/periphery --config-path /etc/komodo/periphery.config.toml
```

## Outbound only

Both target configs express exactly one connection mode and differ only in
`connect_as`:

```toml
root_directory = "/etc/komodo"
core_addresses = ["http://10.20.0.2:9120"]
connect_as = "yecao"        # or "tx1"
server_enabled = false
private_key = "file:/etc/komodo/keys/periphery.key"
core_public_keys = ["file:/etc/komodo/keys/core.pub"]
disable_terminals = false
disable_container_terminals = false
```

- Core is reached on the **private WireGuard address**. The public name
  (`https://komodo.wotbtools.com`), any host public address, and any wildcard bind
  are forbidden and asserted absent.
- `server_enabled = false` means Periphery never opens its inbound port, so **no
  listener exists on `:8120`** on either host. Production verification proves the
  absence at runtime, and the fixture proves the probe detects a deliberately bound
  port.
- No git provider, image registry, Komodo `[secrets]`, stack path override, build
  infrastructure, provider credential, or registry credential is configured.

The config file is the Komodo v2.3.3 schema: the field is `core_addresses` (a list),
with `core_address` kept only as a legacy alias.

## Onboarding credential lifecycle

The runtime variable is generic: **`KOMODO_PERIPHERY_ONBOARDING_KEY`**. The workflow
maps each host's own GitHub secret into it (TX1: `KOMODO_TX1_ONBOARDING_KEY`, TX2:
`KOMODO_TX2_ONBOARDING_KEY`), and the scripts never know a host-specific secret name.

**Yecao's and TX1's credentials have been deleted** (the GitHub secrets and the UI
onboarding keys), so those jobs forward no secret at all and must succeed from
`onboarding-complete` + `periphery.key` + `core.pub`. TX2 still needs its credential
for the first onboarding; the operator deletes `KOMODO_TX2_ONBOARDING_KEY` and the
`tx2-periphery-bootstrap` UI key after that run succeeds, and the following
`workflow_dispatch` must then succeed credential-free.

1. `install.sh` decides from the host state, never from the identity file:
   - **marker valid + identity valid + `core.pub` valid** → onboarding is complete
     and the credential is neither read nor required;
   - **marker absent + credential available** → bootstrap, *or retry a previous
     failed bootstrap reusing the identity it already generated* (the identity is
     never deleted or regenerated because a previous attempt failed);
   - **marker absent + no credential** → fail closed before any host mutation;
   - **marker present but identity or `core.pub` missing/unsafe** → corrupted
     completed state; fail closed instead of regenerating anything;
   - **marker is a symlink, dangling, wrongly owned, wrongly permissioned, or holds
     unexpected content** → fail closed.
2. On a bootstrap it writes the credential to `/run/komodo/periphery-bootstrap.env`
   (tmpfs, mode 0600, root-owned) and waits (bounded) until Periphery has generated
   its identity, pinned the Core public key, and holds a live outbound connection.
3. It deletes the transient file and restarts Periphery **without** the credential,
   then proves the connection came back, the process environment is **provably**
   credential-free, and the service is still active.
4. Only then, and **last**, it atomically writes `keys/onboarding-complete` and
   enables the unit — so the unit is never enabled before onboarding has committed.
5. The process-environment probe has three outcomes: `0` readable and credential
   absent, `1` the credential is still there, `2` the environment cannot be
   inspected. **`1` and `2` both block the commit**; production verification fails
   hard on `2` with a diagnostic.
6. Any unsuccessful bootstrap exit *after the service was started* removes the
   transient file and then terminates the service: `stop` → bounded wait →
   `kill --kill-who=all --signal=KILL` → bounded wait; if the unit still will not
   die, the run ends with a loud `CRITICAL` diagnostic naming the possibly-live
   credential-bearing process.

The credential is never written to the config, the unit, a persistent
`EnvironmentFile`, the repository, or a log. Periphery itself redacts it in the
startup config it logs (v2.3.3 `PeripheryConfig::sanitized`), and the workflow never
echoes it.

## Recovery behaviour

| Situation | Behaviour |
| --- | --- |
| Onboarding marker valid | Binary/config/unit are reconciled from the staged source; the identity, the Core trust anchor, and the marker are **never** regenerated or overwritten. No credential is required |
| Marker absent, identity left over from a failed attempt, credential available | Bootstrap is retried with the existing identity |
| Marker absent + no credential | **Fail closed** before any host mutation |
| Marker valid but identity or `core.pub` missing/unsafe, or the marker itself unsafe | **Fail closed**; corrupted state is never silently repaired |
| Onboarding never completes, or the credential-free restart never reconnects | Bounded wait, then fail closed: credential removed, service **stopped**, marker stays absent |
| The process environment cannot be inspected | **Fail closed** (never treated as evidence of absence) |
| `stop` does not take effect after a failed bootstrap | Escalated to a forced kill; a `CRITICAL` diagnostic if the unit still will not die |
| Symlinked/irregular `/etc/komodo`, keys, binary, unit, or staged path | Refused; the install never follows a link |
| Staged artifact SHA mismatch, or a staged config for another target | Refused before installation |
| Another mutation holds the target's host lock | The reconcile aborts instead of racing it |
| A host's lock root or lock file is missing | **Fail closed**: that host's deploy owner must own them |

Re-running the workflow is always safe and idempotent. A failed bootstrap is
recoverable by re-running while that host's credential is still available; a host
whose marker committed needs no credential ever again.

### Idempotency and availability

An already-completed host whose binary, config, and unit already match the staged
desired state, and whose service is already active, is **left running untouched**:
the reconcile never stops a healthy service, and it restarts only when something the
running agent consumes actually changed or when the service is not running. Replacing
the binary is safe while Periphery runs — the process keeps the inode it started
from — so no preemptive stop is needed. The two directions are both required and
covered by the fixture:

| State observed | Reconcile behaviour |
| --- | --- |
| marker valid, service active, binary/config/unit already exact | no stop, no restart; the service stays active |
| marker valid, binary/config/unit changed | restart, so the new binary/config/unit takes effect |
| marker valid, any of binary/config/unit already exact but the service is **not** active | restart, so a stopped agent is brought back up |

## Production verification

`deploy/periphery/verify.sh <target>` runs after every reconcile, per host and
without any Komodo credential:

1. `/usr/local/bin/periphery` SHA256 equals the pinned digest.
2. The binary reports the pinned version.
3. `systemctl is-enabled periphery` and `is-active periphery` both succeed.
4. `keys/periphery.key` and `keys/core.pub` exist, are non-empty, real, non-symlink.
5. `keys/onboarding-complete` is a valid root-owned mode 0600 marker (never inferred
   from the identity file).
6. An established outbound connection exists from the Periphery main PID to
   `10.20.0.2:9120` (bounded retries).
7. No listener exists on `:8120`.
8. The effective config is **byte-identical** to this target's reviewed config, and
   still declares `connect_as = "<target>"`, the private Core address,
   `server_enabled = false`, and `root_directory = "/etc/komodo"`.
9. No onboarding credential is persisted in the config or the unit, the transient
   `/run` file is gone, and the process environment is provably credential-free.
10. Docker is reachable for the container discovery Periphery performs
    (`/var/run/docker.sock` readable and writable, daemon answering, root context).

Each Server's own `Online` status is confirmed manually after the merge, because it
is Core-side state and intentionally not probed with the admin API.

## Manual acceptance

Per host:

```sh
systemctl is-enabled periphery && systemctl is-active periphery
/usr/local/bin/periphery --version           # 2.3.3
sha256sum /usr/local/bin/periphery           # 40b78f377626799afad8331246a501f077d4ebcfb6d9096894cf55b64f6dcf13
cat /etc/komodo/keys/onboarding-complete     # komodo-periphery-onboarding-v1
grep '^connect_as' /etc/komodo/periphery.config.toml   # "yecao" on Yecao, "tx1" on TX1
ss -ltn | grep ':8120' || true               # must print nothing
```

Then open `https://komodo.wotbtools.com` and confirm:

```text
Servers
├── yecao   OK   v2.3.3
├── tx1     OK   v2.3.3
└── tx2     OK   v2.3.3
```

## Rollback

Per host, stop and remove the agent:

```sh
systemctl disable --now periphery
rm -f /etc/systemd/system/periphery.service
systemctl daemon-reload
```

Removing `/usr/local/bin/periphery` and `/etc/komodo` is optional and deletes the
Server identity *and* the onboarding marker: a later reconcile would then need that
host's bootstrap credential again. Keeping `/etc/komodo` lets a later reconcile
reattach the same Server without any credential. Komodo Core/Mongo, the public
ingress, and DNS are untouched by either choice, and a Server entry can be deleted
from the UI independently.

## Out of scope

Any further host (TX3+), TX2 workload deployments, Business API / Frontend /
Keycloak / AI service migration, stacks, deployments, repos, builds, procedures,
actions, resource sync, automatic updates, OIDC/SSO, registry or git credentials,
WireGuard management (TX2's tunnel predates this phase), Mongo backup changes,
Komodo Core changes, Caddy changes, and DNS changes.

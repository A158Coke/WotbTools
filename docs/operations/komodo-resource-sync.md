# Komodo Resource Sync (K4.1+)

The declarative Komodo control-plane layer: Komodo resources are declared in **this
repository** under `infra/komodo/resources/`, Komodo computes a diff against the live
control plane, and a human reviews and applies it.

ResourceSync Apply changes Komodo resource definitions. It does **not** imply workload
deployment unless a declaration explicitly opts into deploy scheduling; the reviewed
Stacks in this repository keep `deploy = false`.

## Ownership model

```text
Git repository  (infra/komodo/resources/**.toml, reviewed by PR + CI)
      │
      ▼
Komodo ResourceSync  "wotbtools-main"   (managed = false, delete = false, webhook_enabled = false)
      │
      ▼
computed diff                          (pending changes, alerts on pending)
      │
      ▼
manual review                          (a human reads every entry)
      │
      ▼
manual apply                           (a human clicks Apply in the UI)
      │
      ▼
Komodo resources                       (Servers + tightly reviewed Stacks)
```

| Concern | Owner |
| --- | --- |
| Declarative Komodo resources | `infra/komodo/resources/**` (this layer) |
| Komodo Core + MongoDB lifecycle | GitHub Actions + `deploy/komodo/**` |
| Komodo DNS | OpenTofu under `infra/tofu/komodo/**` |
| Periphery agents (systemd) | `deploy/periphery/**` where automated; one-time/manual bootstrap remains a separate host concern |
| Public ingress | workload-specific owner (`deploy/tx/**` or `deploy/assets/**`) |
| Applying a computed diff | **a human**, in the Komodo UI |

Two invariants are enforced by tests, not by convention:

1. **A change under `infra/komodo/resources/**` cannot restart or mutate Komodo
   Core/Mongo/DNS.** The controller's production workflow is wired to
   `deploy/komodo/**` and `infra/tofu/komodo/**` only; the resource tree reaches only
   the non-production deployment contract gate.
2. **Komodo never manages its own controller runtime or Periphery service through
   ResourceSync.** Only `server`, `resource_sync`, and the explicitly reviewed `stack`
   resources are allowed. Periphery addresses, keys, onboarding credentials, and
   inbound `:8120` endpoints are forbidden.

## The declared resources

`infra/komodo/resources/resource-sync.toml` declares `wotbtools-main` with the
non-destructive posture:

```toml
[[resource_sync]]
name = "wotbtools-main"
description = "Declarative Komodo resources for WotBTools, reviewed in Git and applied by hand"
tags = []
template = false

[resource_sync.config]
git_provider = "github.com"
git_https = true
repo = "A158Coke/WotBTools"
branch = "main"
resource_path = ["infra/komodo/resources"]
managed = false
delete = false
webhook_enabled = false
include_resources = true
include_variables = false
include_user_groups = false
pending_alert = true
```

| Setting | Value | Why |
| --- | --- | --- |
| `managed` | `false` | Core never writes back to this repository; Git stays the source of truth |
| `delete` | `false` | a sync can never delete a resource merely because it is absent from Git |
| `webhook_enabled` | `false` | no push-triggered execution/apply; discovery may still happen on periodic polling |
| `include_resources` | `true` | Servers and reviewed Stacks are in scope |
| `include_variables` / `include_user_groups` | `false` | no variable or user-group management |
| `pending_alert` | `true` | a pending diff is visible instead of silent |
| `git_account` / `webhook_secret` | **forbidden** | repository is public; credentials must not live here |

`infra/komodo/resources/servers.toml` adopts four existing production Servers by name:

- `yecao`
- `tx1`
- `tx2`
- `ali-sh-asset-01`

Every field of the Komodo v2.3.3 `ServerConfig` is declared explicitly. The critical
outbound invariant is identical on every host:

- `address = ""` — Periphery dials Core outbound; Core never dials Periphery.
- `enabled = true` — the Server is live.
- `passkey = ""` — legacy inbound authentication is unused.
- no `:8120` endpoint appears anywhere.
- thresholds, alerts, `auto_prune`, `auto_rotate_keys`, `stats_monitoring`,
  `ignore_mounts`, `links`, and `maintenance_windows` stay at the reviewed defaults.

Why every field is spelled out: Komodo converts a partial `[server.config]` through
schema defaults before diffing, so an omitted field is not "leave live value alone".

The reviewed Stack set is also fail-closed:

- `wotbtools-frontend-shadow` → `tx2`, GitHub authority with Gitee transport.
- `wotbtools-asset-origin` → `ali-sh-asset-01`, `deploy/assets/compose.yaml`, GitHub
  authority with Gitee transport for the mainland worker. Its mutating Compose `up`
  also serializes on the host's existing `/opt/wotb-asset/.deploy.lock` through
  `compose_cmd_wrapper`, so it can never overlap a Periphery reconcile.

Both keep `deploy = false`, `webhook_enabled = false`, `auto_update = false`, and
`poll_for_updates = false`. ResourceSync adoption/update is therefore separate from an
explicit workload Deploy action.

### Metadata Git owns: `tags`, `template`, `description`

For every resource type, Komodo v2.3.3 compares `description`, `template`, and `tags`
as well as config. `ResourceToml::tags` defaults to `[]`, so omitting tags asserts the
empty set rather than preserving live tags.

Therefore:

- `tags = []` and `template = false` are declared explicitly on every resource.
- Git owns the Server tag set. The reviewed tag set for all four hosts is empty.
- A tag diff on first adoption is a **STOP condition**, not noise to apply.
- Periphery private/public keys, Core trust key, and onboarding credentials are not
  Server desired-state fields and do not belong in this resource tree.

## How a pending diff appears

- Webhook-triggered execution/apply is disabled (`webhook_enabled = false`).
- Core periodically recomputes pending sync state, so a Git change can appear without
  a human pressing Refresh.
- Manual Refresh forces immediate recomputation.
- Apply remains manual in every case.

## Static validation

`scripts/ci/test-komodo-resources.py` (stdlib `tomllib`, run by the deployment PR gate)
fails closed when:

- TOML cannot be parsed or a resource has no name;
- duplicate resource names exist;
- any resource type outside `server`, `resource_sync`, `stack` appears;
- a declaration carries an unreviewed key;
- `description`, `tags`, or `template` is omitted;
- ResourceSync differs from the reviewed non-destructive configuration;
- a credential-shaped key appears anywhere;
- any Server differs from the exact set `yecao` / `tx1` / `tx2` /
  `ali-sh-asset-01`, uses inbound address/passkey/8120, or omits a v2.3.3 config field;
- the Stack set differs from `wotbtools-frontend-shadow` +
  `wotbtools-asset-origin`, or either Stack gains unreviewed config, automatic update,
  webhook deployment, or the wrong target Server;
- `wotbtools-asset-origin` loses its tracked Caddyfile `config_files` entry, its
  `--force-recreate` deploy args, or its `compose_cmd_wrapper` (mandatory
  `[[COMPOSE_COMMAND]]` placeholder, non-blocking `flock` on the **existing**
  `/opt/wotb-asset/.deploy.lock` only, `compose_cmd_wrapper_include = ["up"]`, and no
  second or Periphery-only lock).

The test inspects TOML structure, never descriptions, so prose cannot make it pass.

## Bootstrap / adoption review

`wotbtools-main` itself is bootstrapped once by hand. New resources may also be
created manually first (for example a Server created by Periphery onboarding or an
empty Stack created in the UI) and then **adopted by exact name** through this sync.

Before Apply:

1. Refresh / compute pending changes.
2. Review every diff entry.
3. Current expected resource scope is exactly:

   ```text
   ResourceSync  wotbtools-main
   Server        yecao
   Server        tx1
   Server        tx2
   Server        ali-sh-asset-01
   Stack         wotbtools-frontend-shadow
   Stack         wotbtools-asset-origin
   ```

4. No Deployment / Build / Repo / Procedure / Action / Builder / Swarm / Alerter /
   Variable / UserGroup creation or deletion is acceptable.
5. No Server may gain an inbound address or passkey; no Periphery identity/key field
   may change.
6. Any unexpected tag diff is a STOP condition.
7. For a newly adopted Stack, confirm `deploy = false` and the exact reviewed target
   Server/source before Apply.
8. Apply only after the diff is understood.
9. Refresh again; expected result is zero pending diff.

For the Alibaba asset origin specifically, applying the sync must only adopt/update
`ali-sh-asset-01` and `wotbtools-asset-origin`. Asset payload staging, DNS, firewall,
explicit Stack Deploy, canary, and client origin cutover remain separate steps documented
in `deploy/assets/README.md`.

## Reversible drift proof

A harmless metadata change can prove the loop end to end:

1. edit one Server/Stack description in Git;
2. merge to `main`;
3. confirm one precise Update and no unrelated changes;
4. manually Apply;
5. Refresh to zero pending;
6. revert in Git and repeat the Apply in reverse.

## Routine operation

- A merged change under `infra/komodo/resources/**` produces a pending diff either on
  periodic polling or manual Refresh; nothing is applied automatically.
- Review, Apply, then Refresh to zero pending.
- Rollback is a Git revert plus manual Apply.
- Git-side syntax/contract errors are caught by
  `python3 scripts/ci/test-komodo-resources.py` before merge.

## Out of scope

General workload migration (Business API, Keycloak, AI service), automatic or
webhook-triggered apply, `managed = true`, `delete = true`, registry/Git credentials,
secret migration, Periphery key lifecycle, Komodo Core/Mongo lifecycle, and unrelated
DNS/Caddy ownership remain out of scope. The two reviewed Stack exceptions are the TX2
frontend replica and the Alibaba Shanghai static asset origin; neither is deployed by
ResourceSync Apply.

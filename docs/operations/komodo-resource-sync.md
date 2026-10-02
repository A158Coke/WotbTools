# Komodo Resource Sync (K4.1)

The first declarative Komodo control-plane layer: Komodo resources are declared in
**this repository** under `infra/komodo/resources/`, Komodo computes a diff against
the live control plane, and a human reviews and applies it.

Nothing in K4.1 migrates a workload, deploys anything automatically, or lets Komodo
manage its own runtime.

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
Komodo resources                       (Servers; later phases add more)
```

| Concern | Owner |
| --- | --- |
| Declarative Komodo resources | `infra/komodo/resources/**` (this layer) |
| Komodo Core + MongoDB lifecycle | GitHub Actions + `deploy/komodo/**` |
| Komodo DNS | OpenTofu under `infra/tofu/komodo/**` |
| Periphery agents (systemd) | GitHub Actions + `deploy/periphery/**` — see [`komodo-periphery.md`](komodo-periphery.md) |
| Public ingress | TX Caddy owner |
| Applying a computed diff | **a human**, in the Komodo UI |

Two invariants follow from that table and are enforced by tests, not by convention:

1. **A change under `infra/komodo/resources/**` cannot restart or mutate Komodo
   Core/Mongo/DNS.** The controller's production workflow is wired to
   `deploy/komodo/**` and `infra/tofu/komodo/**` only;
   `scripts/ci/test-workflow-contract.sh` asserts that no controller path pattern
   matches a resource file, and that the only owner a resource change reaches is the
   non-production `deployment` PR gate (which just runs the contract test below).
2. **Komodo never manages its own controller runtime or the Periphery service.** No
   Stack/Deployment/Build/Repo/Procedure/Action/Builder/Swarm/Alerter/Variable/
   UserGroup is declared in K4.1, and no Server declaration carries a Periphery
   address, key, or credential.

## The declared resources (K4.1)

`infra/komodo/resources/resource-sync.toml` — the sync that reads its own directory:

```toml
[[resource_sync]]
name = "wotbtools-main"
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
| `managed` | `false` | Core never writes back to this repository; Git stays the only source of truth |
| `delete` | `false` | a sync can never delete a resource that is not declared here |
| `webhook_enabled` | `false` | a push computes a diff but never applies it |
| `include_resources` | `true` | Servers are in scope |
| `include_variables` / `include_user_groups` | `false` | no variable or user-group management in K4.1 |
| `pending_alert` | `true` | a pending diff is visible instead of silent |
| `git_account` / `webhook_secret` | **absent** | the repository is public; no credential may live in Git |

`infra/komodo/resources/servers.toml` — the three existing production Servers
(`yecao`, `tx1`, `tx2`) are **adopted by name**, never recreated, and every field of
the Komodo v2.3.3 `ServerConfig` is declared explicitly:

- `address = ""` — Periphery dials Core **outbound**, so Core must not dial
  Periphery. No `:8120`, no public address, no WireGuard address ever appears here.
- `enabled = true` — the Servers are live (the schema default is `false`).
- `passkey = ""` — legacy inbound authentication is unused.
- thresholds, alert toggles, `auto_prune`, `auto_rotate_keys`, `stats_monitoring`,
  `ignore_mounts`, `links`, `maintenance_windows` — the documented v2.3.3 defaults.

Why every field is spelled out: Komodo converts a **partial** `[server.config]`
through the schema defaults before diffing, so an omitted field does **not** mean
"leave the live value alone" — it means "assert the default". Declaring the complete
field set makes the first diff reviewable instead of silently resetting a production
setting.

Periphery keys, the Core trust anchor, onboarding credentials, and the
`onboarding-complete` marker are **not** Server desired-state fields and remain owned
by `deploy/periphery/**` + systemd.

## Static validation

`scripts/ci/test-komodo-resources.py` (Python stdlib `tomllib`, run by the
non-production `deployment` PR gate) fails the build when:

- a TOML file cannot be parsed, or a declared resource has no name;
- two resources of the same type share a name (across files too);
- a resource type outside `server` / `resource_sync` appears — `stack`,
  `deployment`, `build`, `repo`, `procedure`, `action`, `builder`, `swarm`,
  `alerter`, `variable`, `user_group` are rejected by name;
- a declaration carries an unreviewed key (Komodo would ignore a typo silently);
- the ResourceSync is not exactly `wotbtools-main` with the reviewed, non-destructive
  configuration above;
- the Servers are not exactly `yecao`/`tx1`/`tx2`, are disabled, carry a non-empty
  `address` or `passkey`, are declared `template`/`deploy = true`, omit any
  `ServerConfig` field, or declare a value other than the reviewed default;
- any key anywhere looks like a credential (`password`, `secret`, `token`,
  `private_key`, `onboarding_key`, `git_account`, `webhook_secret`, …) or any value
  references port `8120` or an `http(s)://` / `ws(s)://` address.

The test inspects TOML structure, never descriptions, so prose cannot make it pass.

## First bootstrap (manual, once)

The first sync is created by hand, because the sync that reads this directory cannot
create itself:

1. Open the Komodo UI.
2. Create a **Resource Sync**: name `wotbtools-main`, provider `github.com`,
   repository `A158Coke/WotBTools`, branch `main`, resource path
   `infra/komodo/resources`.
3. Leave **Managed** mode **OFF**.
4. Leave **Delete** mode **OFF**.
5. Leave **Webhook execution** **OFF**.
6. Refresh / compute pending changes.
7. **Do not apply yet.**
8. Review every diff entry.
9. Expected resource scope — exactly these four, and nothing else:

   ```text
   ResourceSync  wotbtools-main
   Server        yecao
   Server        tx1
   Server        tx2
   ```

10. No Stack / Deployment / Build / Repo / Procedure / Action creation **or**
    deletion is acceptable in K4.1.
11. No Server may gain an inbound `address` (any `http(s)://…:8120` value is wrong).
12. No Periphery identity/key field may change.
13. Only after that review: **Apply**.
14. Refresh again.
15. Expected result: **zero pending diff**.

Expected first diff: the Servers are already running with their defaults, so the only
entries should be the description text (and possibly an empty-tags or
ResourceSync-self entry). Anything else — especially a proposed `address`, a
deletion, or a threshold move — means the live control plane differs from the
documented baseline: **stop, do not apply**, and reconcile the difference by hand
first.

## Reversible drift proof

Proves the loop end-to-end without touching a workload:

1. Make a harmless metadata change in Git, e.g. edit one Server `description`.
2. Merge it to `main`.
3. Resource Sync shows **one precise Update** for that Server (no deletions, no other
   resources).
4. Manually **Apply**.
5. Refresh → **zero** pending diff.
6. Revert the Git change and merge.
7. The reverse diff appears.
8. Manually **Apply**.
9. Refresh → **zero** pending diff.

Reminder: webhook-triggered apply is **off**, so step 3 requires a manual Refresh.

## Routine operation

- A merged change under `infra/komodo/resources/**` produces a pending diff (and a
  pending alert). Nothing is applied automatically.
- Review, then Apply, then Refresh to confirm zero pending.
- Rollback is a Git revert plus a manual Apply — the same reviewed path in reverse.
- If the sync reports an error, the UI stores it on the sync; a Git-side syntax
  problem is caught earlier by `python3 scripts/ci/test-komodo-resources.py`.

## Out of scope in K4.1

Workload migration (Business API, Frontend, Keycloak, AI service), the disposable TX2
workload (K5), automatic or webhook-triggered apply, `managed = true`, `delete = true`,
registry or Git credentials, Komodo API service accounts, secret migration, Periphery
lifecycle changes, WireGuard management, Komodo Core/Mongo lifecycle changes, Caddy,
DNS, and any change to `deploy/komodo/**` or `infra/tofu/komodo/**`.

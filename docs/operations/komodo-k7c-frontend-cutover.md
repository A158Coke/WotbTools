# Komodo K7C — Frontend active-active closeout

K7C is complete. The public `wotbtools.com` frontend now runs as a two-instance production pool behind the TX1 Caddy gateway:

- TX1 frontend: `10.20.0.1:8081` — steady-state weight 20%;
- TX2 frontend: `10.20.0.3:8081` — steady-state weight 80%;
- Caddy remains on TX1 and owns public 80/443;
- both peers are actively health-checked through `/version.json`;
- Business API, Keycloak, PostgreSQL and AI placement are unchanged by K7C.

The historical K6B placement baseline remains frozen. K7C changes the frontend runtime topology only; it does not rewrite the K6B migration record.

## Final release ownership

The frontend release path is now:

```text
GitHub main
  -> mirror exact source to Gitee
  -> TX1 pulls/builds from Gitee
  -> TX1 publishes an immutable frontend image to TCR
  -> TX1 deploys that immutable artifact
  -> Frontend Replica resolves the same published artifact
  -> TX2 pulls it directly from TCR
  -> TX2 deploys the exact immutable digest
  -> TX1/TX2 version parity is verified
```

TCR is the release-artifact source of truth for TX2. TX2 does not derive its deployment image by inspecting TX1's running container.

Komodo keeps the TX2 Stack definition as reviewed declarative metadata and runtime visibility. It does not own automatic image rollout for this Stack: polling, webhook deployment and automatic workload updates remain disabled so they cannot race the production Frontend Replica workflow.

## Runtime-content ownership

The frontend image is not the whole production surface. The current Android public download surface is host-owned runtime content. (Sponsor QR content is not: it is injected at build time from a pinned Release asset and ships inside the Frontend image / APK — see `docs/operations/sponsor-runtime-content.md`.)

K7C replicates only the **current public production surface** to TX2 local storage at `/opt/wotb-tx2/runtime-content`:

- Android `version.json`;
- the APK actually referenced by that manifest.

Historical APKs are deliberately not copied, and the published `version.json` + its APK stay the only replicated *published* surface. The single exception is `*.staging.json` records: the android-release stage installs a **staged-but-unpublished** release identity into this same tree (atomically, under `/opt/wotb-tx2/.deploy.lock`) and its publish phase re-reads it through the public URL, which load-balances across TX1/TX2 — so the sync carries any existing record over while it holds that same lock, which is what makes install and tree-rebuild mutually exclusive (2026-10-09: without the lock and the carry-over, the record was deleted on TX2 before publish and the public URL became a per-origin coin flip). See [android/release-process.md](../android/release-process.md) §证据的存续. TX2 never bind-mounts `/opt/wotb-tx` and never reads the TX1 filesystem directly; it owns a local replicated runtime-content root.

The production Frontend Replica workflow refreshes this runtime content before TX2 is accepted after a frontend release.

## Preflight evidence

Before public cutover, the read-only K7C preflight required:

1. TX1/TX2 frontend roots return HTTP 200.
2. TX2 SPA fallback and `/api/health` return HTTP 200.
3. TX1/TX2 `/` and `/version.json` are byte-identical.
4. Android `version.json` is byte-identical.
5. the APK referenced by authoritative Android `version.json` is byte-identical.
6. Caddy still targets the reviewed pre-cutover frontend placement.

Production evidence recorded during K7C:

```text
TX2_FRONTEND_SHADOW_READY=PASS
K7C_RUNTIME_CONTENT_READY=PASS
K7C_FRONTEND_CUTOVER_PREFLIGHT=PASS
```

The initial Caddy cutover to TX2 completed successfully, followed by promotion to the final two-peer 20/80 pool.

## Production acceptance

The final production topology has been exercised by a real frontend release after the TCR-source correction:

```text
Frontend workflow                 PASS
TX1 build from Gitee              PASS
immutable TCR publish             PASS
TX1 frontend reconcile            PASS
Frontend Replica workflow         PASS
TX2 direct TCR pull               PASS
TX2 immutable-digest reconcile    PASS
TX1/TX2 version parity            PASS
```

Reference production runs from the closeout sequence:

- Caddy Gateway cutover run `37236109552` — success;
- Frontend run `37283193116` — success;
- Frontend Replica run `37283700560` — success.

The successful Replica run used the final release model: `Resolve published Frontend artifact` followed by `Pull TCR artifact and reconcile TX2`.

## Final traffic contract

Caddy serves both reviewed frontend peers with weighted round-robin:

```text
TX1 10.20.0.1:8081  weight 2  (~20%)
TX2 10.20.0.3:8081  weight 8  (~80%)
```

An unhealthy peer is removed by active health checking. Caddy itself remains a TX1 single point of ingress; K7C provides frontend workload redundancy, not gateway-node redundancy.

## Rollback boundary

K7C keeps the operational rollback boundary explicit:

- either frontend peer can be removed from public selection by changing the reviewed Caddy pool;
- TX1 remains a complete frontend instance;
- TX2 can be rebuilt from the immutable TCR artifact plus replicated current runtime content;
- Business API, Keycloak, PostgreSQL and AI do not move during frontend rollback.

Do not repurpose the frozen K6B placement matrix to describe this active-active topology. K6B remains the migration baseline; this document is the K7C steady-state authority.

## Known follow-up outside K7C closeout

K7C guarantees steady-state image/version parity and health-checked dual service. The current release sequence can still have a short rolling window in which TX1 has the new frontend release while TX2 is reconciling the same TCR artifact. Eliminating all mixed-version serving would require a separate drain/reweight or blue-green rollout design and is intentionally outside this closeout.

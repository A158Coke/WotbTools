## Workflow ownership

The repository has one pull-request validation entry point and service-owned production workflows. Each workflow declares its owned inputs in both `on.push.paths` and `PRODUCTION_INPUT_PATHS`; `deploy/check-production-freshness.sh` permits an older main push only when its source is an ancestor of current `main` and those owned inputs are unchanged. Manual dispatch requires the exact current `main` SHA. The five image workflows queue only their deploy jobs so builds and smoke checks can run concurrently; infrastructure owners, including Caddy, retain workflow-level `production-maintenance` serialization. Host mutations use the host-level `flock`; do not restore the removed Release/Build/Deploy/Tofu reusable-workflow DAG.

- `ci.yml` is the only PR validation workflow and owns `CI / Required Gate`. Its CI-only selector is `scripts/ci/ci-impact.py`; PR OpenTofu jobs run `fmt`, `init -backend=false`, `validate`, and local safety fixtures only. PR CI has no production credentials, SSH, image push, production state, plan, or apply. The three data-update workflows remain separate and can dispatch CI for the exact open PR head.
- `business-api.yml`, `frontend.yml`, `keycloak.yml`, `parser-worker.yml`, and `minio.yml` own their individual application image and deploy pipelines. TX images use TCR; Yecao images use GHCR. Each deploy pins the selected immutable image identity. Business API and parser-worker run read-only consumer-side dependency probes before mutation. Keycloak and MinIO defer metadata until their runtime, OpenTofu, and verification chain succeeds.
- `caddy.yml` is the independent TX gateway owner. It stages and validates Caddy configuration/assets, reconciles only the gateway, refreshes frontend trusted-peer state when needed, and verifies TLS, redirects, and required routes. It does not build an application image, depend on database/admin credentials, or update application image metadata.
- `rabbitmq.yml`, `business-postgres.yml`, and `keycloak-postgres.yml` own their TX runtime and host-local OpenTofu root. `observability.yml` owns Yecao observability runtime and Grafana dashboard OpenTofu. Keep each provider, state, secrets, plan guard, and readiness check scoped to its owner.
- `android-release.yml`, `database-backup.yml`, `cleanup-images.yml`, and `prod-diagnostics.yml` keep their independent release, backup, cleanup, and read-only diagnostics responsibilities.
- `update-tankopedia.yml`, `update-equipment.yml`, and `update-crew-skills.yml` remain independent automation entry points. Preserve their contents/PR/actions permissions and exact-head CI dispatch protocol; do not fold them into production workflows.

## Change rules

- Before changing a workflow, read its real scripts and the relevant `deploy/AGENTS.md`/OpenTofu contracts. Keep CI commands consistent with local commands and the pinned JDK/Node versions.
- Do not place credentials in workflow files. Scope `secrets.*`, `vars.*`, job permissions, and protected environments to the job that consumes them. TX production jobs use the existing `tx-production` environment; do not invent an unconfigured Yecao environment.
- Main-triggered production workflows must reject non-ancestor sources and changes to owned inputs before expensive work, then recheck immediately before staging or host mutation as applicable. Manual dispatch must remain pinned to the exact current `main` SHA. Keep TX and Yecao host locks held across runtime mutation, OpenTofu plan/apply/second-plan, verification, and deferred metadata update where the service contract requires it.
- OpenTofu ownership stays with the matching standalone root workflow. PR validation never reads production state or creates an authenticated production plan. Main workflows re-plan locally and apply the exact guarded saved plan.
- Keep the stable `CI / Required Gate` as the only required PR check. Do not add heavy, non-gating jobs to every change or duplicate PR test suites inside production deployment workflows.
- Do not restore discarded PR #380 content or architecture. It is not a source for this plan.

## Workflow inventory (19)

`ci.yml`, `business-api.yml`, `frontend.yml`, `caddy.yml`, `keycloak.yml`, `parser-worker.yml`, `minio.yml`, `rabbitmq.yml`, `business-postgres.yml`, `keycloak-postgres.yml`, `observability.yml`, `android-release.yml`, `database-backup.yml`, `cleanup-images.yml`, `prod-diagnostics.yml`, `update-tankopedia.yml`, `update-equipment.yml`, and `update-crew-skills.yml`.

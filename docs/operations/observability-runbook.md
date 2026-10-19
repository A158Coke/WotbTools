# Observability runbook

## First checks

Grafana: https://monitor.wotbtools.com. Home is **Active users**; all dashboards default to the last 24 hours in Beijing time. Select Today for the local calendar day. Never interpret No data as verified zero usage.

On Yecao:

```bash
cd /opt/wotb
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml logs --tail=100 alloy loki prometheus ai-service
```

On TX:

```bash
cd /opt/wotb-tx
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml logs --tail=100 alloy-tx business-api keycloak
```

Prometheus must have seven UP jobs: wotb-backend (WireGuard `10.20.0.1:8088`), ai-service, node-exporter, prometheus, loki, grafana, dev-metrics (engineering exporter `dev-metrics-exporter:9108`). Node-exporter covers Yecao only; use existing Komodo for other host resource views. Keycloak has no Prometheus job or separate management-endpoint contract; use OIDC discovery and logs.

## Missing activity or feature data

1. Confirm the client includes the new telemetry producer; older Web bundles/APKs cannot emit these events.
2. In DevTools verify `/api/observability/events` returns 204. Never copy bearer headers or request identities into tickets.
3. For active-user 503, verify the business-api runtime has a configured `WOTB_OBSERVABILITY_HASH_KEY` of at least 32 characters without printing it. Provision the repository-level Actions secret and deploy the owner normally. A 401 means no valid verified identity; do not bypass auth.
4. Check business-api structured logs for `event=product_telemetry`, then check TX Alloy → WireGuard → Yecao Loki.
5. Events are best effort; offline/blocked uploads and shutdown can undercount. Query-series-limit errors are explicit failures, not partial populations. Inspect Loki logs and query cost before raising limits.

```logql
{container_name="wotb-backend"} |= "event=product_telemetry " | json | line_format "{{.message}}" | logfmt
```

## Find an error

Open **Backend error logs**, choose time/source, then enter a literal keyword or Error ID. Functional rows cover login, HoF, tournament, AI, client parsing and other errors. Expand records for path, stable error code, source service and safe server diagnostics. Client parsing rows are user-device reports, not proof of server failure. Raw replay names or exception text are intentionally absent.

For Keycloak callbacks, use the login row plus Caddy/Keycloak sources and OIDC discovery; retain the existing deployment E2E auth-token probe. Never weaken TLS verification to make a probe pass.

For AI, search the correlation/error ID and follow `ai_upstream_call_failed`, `ai_review_contract_failed`, `ai_review_recovery_triggered`, `ai_review_recovery_failed`, `team_review_completed`, and the safe `ai_review_error` event. These events come from `container_name="ai-service"`, not the backend stream. Legacy `ai_review_started/finished/failed` lifecycle names have no producers; do not depend on them.

```logql
{container_name="ai-service"} | json | line_format "{{.message}}" | logfmt | event=~"ai_token_usage|ai_review_usage|ai_review_error"
```

## Downloads and token questions

- Android downloads separates 200, 206 and failures. A partial-request count is not an installation count. Check nginx access output and sanitized frontend Loki stream if a version is missing.
- AI totals count known usage at receipt time. Average counts terminal reviews at completion time. Check missing-usage calls before comparing to a provider invoice; cancellation/timeouts can hide billed usage the provider never returned.
- Page views are not successful operations. Replay parsing counts files with separate starts and outcomes, not opening the workspace.

## Retention and recovery

Queryable history is limited to seven days. Loki physical compaction is asynchronous; raw Docker logs still use size rotation and may outlive the query window. Do not claim strict seven-day physical erasure, add long-lived telemetry backups, delete active Docker log files, or use `docker compose down -v`.

Dashboard changes are applied through `infra/tofu/grafana` and the observability owner workflow. Any dashboard can be deleted/replaced without an allowlist; datasource deletes remain blocked. Recover content from Git by restoring declarations and applying a reviewed plan, never by overwriting live state. A partial apply requires inspecting current state and a new plan; do not automatically restore old state.

Production acceptance: verify real user activity, a batch of ten replay files with success/failure/cancel paths, a page re-entry, APK 200/206 behavior, and AI known/missing usage. Deployment canaries alone do not prove these user flows.

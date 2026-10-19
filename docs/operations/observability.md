# Observability and product usage

The dashboards answer the maintainer's questions: who used the product, which features were opened, how many replays were parsed, how many times users clicked the final Web APK download button, what AI tokens were consumed, and which errors occurred. There is no new alert or notification system.

## Ownership and topology

- Yecao hosts Prometheus, Loki, Alloy, Grafana, node-exporter, dev-metrics-exporter and the independent ai-service.
- TX business-api exposes management metrics on WireGuard `10.20.0.1:8088`. TX `alloy-tx` sends business-api, Keycloak, frontend and Caddy logs to Yecao Loki at `10.20.0.2:3100`.
- Yecao Alloy collects `ai-service` by its exact Compose service label. Its name-based backend/Keycloak/frontend rules remain for deployment canaries.
- Grafana is private on `10.20.0.2:3000`, exposed through TX Caddy at https://monitor.wotbtools.com. Anonymous login and sign-up are disabled.
- `infra/tofu/grafana` alone owns dashboards; canonical JSON lives in `deploy/observability/grafana/dashboards`. Datasources remain read-only file provisioning, UIDs `prometheus` and `loki`.
- Existing Komodo/Periphery host monitoring remains independent and is not changed here.

## Dashboards

The five product dashboards default to last 24 hours, use `Asia/Shanghai`, and link to each other while preserving the selected range. **Today** means midnight Beijing time to now. Choose last 7 days or a custom range within the retention window. Empty results are displayed as No data, not a verified zero.

| Dashboard | UID | What it measures |
|---|---|---|
| Engineering Overview | wotbtools-engineering-overview | GitHub PR/CI aggregates, history, freshness and production correlation |
| Active users (home) | wotbtools-active-users | Distinct authenticated accounts with received foreground activity signals |
| Feature usage | wotbtools-feature-usage | Per-file parse starts/outcomes and page/capability opens, by Web/Android |
| Android downloads | wotbtools-android-downloads | Final **下载 APK** button clicks on the Web `/download/android` page |
| AI token usage | wotbtools-ai-token-usage | Known input/output/total tokens, per-review average and missing usage |
| Backend error logs | wotbtools-backend-error-logs | Login, HoF, tournament, AI, client parsing and other error sections |

The six former dashboards are deleted through OpenTofu. Dashboard deletion and replacement are ordinary desired-state operations: **no delete allowlist**. Datasource deletion stays prohibited. Never remove the Grafana volume or edit state to delete a dashboard.

## Client telemetry

`POST /api/observability/events` accepts a bounded batch described by `contracts/http/openapi.yaml`. The backend strictly validates fields, enums, timestamps, batch/body size and request rate before logging any events. It never accepts arbitrary client log text, account identity, file names or replay contents.

- Limits are fixed-minute **event** quotas after full bounded batch validation: authenticated subjects each get 120 events/minute, sharing an authenticated 6000-events/minute pool; anonymous sources each get 120 events/minute, sharing a separate anonymous 6000-events/minute pool. A 20-event batch costs 20; invalid or over-quota batches consume no quota and emit no telemetry. Each pool tracks at most 4096 keys; a full key map rejects new identities while existing ones can still use remaining quota. Minute rollover resets both pools and maps.
- Anonymous source uses normalized `X-Real-IP` only when the socket peer matches `WOTB_OBSERVABILITY_TRUSTED_PROXIES` (empty by default). TX Compose explicitly trusts the private `wotb_tx_internal` bridge `172.29.0.0/16` (including same-host hairpin NAT) and TX2 frontend WireGuard host `10.20.0.3/32`. This boundary trusts workloads on that private bridge and the TX2 host; neither backend port nor this network may be exposed to untrusted callers. Caddy is the sole public ingress; frontend nginx trusts Caddy real-IP processing and **overwrites** `X-Real-IP` with its resolved `$remote_addr`. Backend ignores `X-Forwarded-For`/`Forwarded`; untrusted peers or missing/duplicate/invalid `X-Real-IP` fall back to the socket peer. Only single literal IPs are accepted (no DNS, lists or zone IDs); IPv6 is canonicalized. Source hashes remain minute-salted, JVM-only, never logged/persisted or used as visitor identifiers. Placement/network changes must update this explicit proxy boundary; no blanket private-network or public trust is inferred.
- Authenticated foreground activity: app initialization, login settlement, foreground return, page changes and at most one regular five-minute heartbeat. Hidden tabs pause activity. Backend validates the bearer token and hashes its subject; the client cannot name an account.
- Deployment secret `WOTB_OBSERVABILITY_HASH_KEY` must contain at least 32 characters. It is supplied only to the business-api workflow/runtime, never committed. Empty/short keys disable authenticated activity ingestion; feature/parse telemetry remains available. Provision it as a repository-level Actions secret before relying on user counts. Keep it stable for at least the seven-day query window; rotation splits identities across the window.
- Account hashes stay in the log **content**, not indexed stream labels or Prometheus labels. Active users are deduplicated across Web/Android; platform counts overlap and must not be added.
- Other telemetry can be anonymous. Feature opens include initial entry, refresh and returning to a feature; parameter-only navigation within one feature does not count again. Managed/admin, documentation, contact and More pages are excluded. The current Web download page does not emit a `feature_open/android_download` signal; the final APK button emits the distinct `android_download_click` event instead, and Feature usage excludes `android_download`. Legacy cached bundles may still send the former `feature_open/android_download` page-open shape during rollout; the backend accepts it for compatibility but Android Downloads ignores it.
- Replay counters are per file entering a parse task. Ten selected files mean ten starts. Each operation has at most one success/failure/cancelled outcome. In-flight/page crashes are not automatically classified as failure. Re-parsing counts again.
- Ordinary queued telemetry only enqueues or sends while the authoritative connectivity state is online. Disconnect discards queued events; reconnect never replays offline usage. The first page can wait for initial connectivity settlement and is counted once if online. The final Web APK click is an immediate best-effort exception: it attempts a `keepalive` send on click without a separate connectivity gate and may simply fail if connectivity is unavailable.
- The ordinary sender holds only a bounded in-memory queue; it does not persist visitor identity or offline history, and does not retry failed batches. Offline, old clients, blocked telemetry and page shutdown can undercount. The final Web APK click bypasses the five-second queue and never retries or blocks the download link. Do not use these counts for billing, security audit or exact population estimates.
- Foreground activity is periodic, so the newest few minutes can be incomplete. Requests are recorded at backend reception time; client `occurred_at` is diagnostic content, not a trusted Loki timestamp.

## AI token semantics

`ai_token_usage` is emitted for upstream attempts at received-usage time. `inputTokens`, `outputTokens` and `totalTokens` are independent provider values; reasoning/cache counters are subsets and must not be added to total again. Failed/cancelled calls contribute any usage actually received. A provider call without usage emits `usageMissing=1`; absence is not evidence of zero spend.

`ai_review_usage` is emitted once when an executed review finishes, combining internal calls/retries into one user review, including failed or in-worker rejected reviews. HTTP rejections before worker execution do not count. The average divides the sum of these terminal review totals by their count. A request spanning the time boundary therefore belongs to the average's completion window while individual usage belongs to its receipt window. Never divide the receipt-window total by an unrelated request count.

The dashboard reports **known consumption**, not the provider's invoice; missing usage is shown separately. There are no live/paid provider calls in ordinary tests.

## Android downloads

`Android downloads` is the product-interaction metric for the final **下载 APK** button on the Web `/download/android` page. Opening `/download/android`, including navigation from Home or any other entry point, is not a download and is not counted.

Each new click is logged as `event=product_telemetry telemetry_event=android_download_click feature=android_download platform=web`. Legacy download-page-open telemetry uses `telemetry_event=feature_open feature=android_download platform=web`; it can remain accepted during a rolling Web deployment but is a different protocol event and is never queried as a download click. Retained page-open rows and old cached Web bundles therefore cannot be relabeled as new download clicks.

The click event is sent immediately with `keepalive` and never gates navigation. It expresses download intent only. The dashboard deliberately ignores the later Caddy 302, Tsinghua Cloud transfer, HTTP 200/206/range behavior, bytes served and installation. The former frontend APK HTTP-request metric is **retired and replaced**, not merged into this series, so pre-cutover request/page-view history is not presented as click history.

## Error logs

`Backend error logs` has functional rows for account/login, HoF (including hundred/mark3), tournament, AI, client-reported replay parsing and other errors. Filter the source service, literal keyword and Error ID, then expand the log entry. Functional matching uses existing path/event/error-code context and can overlap; the Other section excludes recognized sections.

Server error logs retain existing safe diagnostics. AI uses safe event/error-code fields without raw provider bodies; client parser errors contain only approved classifications and generated IDs. Do not send tokens, authorization headers, user identifiers, raw model output/prompt or replay data to telemetry.

## Storage and limits

| Storage | Retention / bound |
|---|---|
| Prometheus | 168h, 2GB TSDB size bound |
| Loki | 168h retention by default; query lookback 4560h (190d), maximum query length 168h |
| Loki security stream | `{compliance="security"}` only: 4560h (190d) retention — see [`security-log-retention.md`](security-log-retention.md) |
| Grafana | Persistent database; dashboards are code, not usage storage |
| Client queue | Bounded memory only; discarded batches are not retried |
| Docker stdout | Existing 20MB × 3 size rotation; no time-based expiry |

One stream is deliberately exempt from the seven-day window: lines labelled `compliance="security"` (Keycloak realm events and the Caddy `/api/*` and auth-domain access logs) are retained for 190 days under a `retention_stream` override. Nothing else is, and ordinary telemetry must never carry that label — the boundary, the redaction rules and the compliance query recipe live in [`security-log-retention.md`](security-log-retention.md).

Loki's compactor removes expired chunks asynchronously (10-minute compaction, 2-hour delete delay). Seven days is the **queryable telemetry window** for everything outside that stream, not a claim that every physical copy is erased exactly at hour 168. Docker size rotation can keep low-volume raw logs longer than seven days. Strict physical age deletion is not implemented; it would require a separate reviewed host logging lifecycle, not deleting Docker-owned files behind its back. Do not add telemetry to long-lived backups.

Account-group queries have an explicit `max_query_series=10000` ceiling; exceeding it returns a query error rather than silently truncating users. Validate seven-day production query cost and memory before treating the dashboard as operationally accepted; Loki's 256MiB memory limit remains unchanged.

## Validation and deployment

PR CI performs native Prometheus/Loki/Alloy validation, real Docker emitter → Alloy → Loki smoke, Grafana datasource/dashboard API smoke, HTTP contract checks and targeted semantic tests. New producers are deployed after the receiver/collector where possible; independent service owners can otherwise produce a temporary undercount, not a product outage. Web APK-click telemetry requires the new Web bundle; old cached bundles cannot emit `android_download_click`, so their legacy page-open events remain accepted only for rolling compatibility and are excluded from the click dashboard.

`observability.yml` reconciles the runtime, plans the Grafana root against its existing local state, applies the exact saved plan, requires a clean second plan, verifies all six current UIDs and verifies the six retired UIDs return 404. The default home file and runtime probes use Active users. Keep the seven-target Prometheus gate (backend, AI, node-exporter, Prometheus, Loki, Grafana, dev-metrics) even though infrastructure charts no longer appear on the home dashboard.

Deployment canaries prove ingestion paths, not actual activity from every production service. Runtime acceptance must check real received client activity, a parse batch, one final Web **下载 APK** click with a matching `android_download_click` backend telemetry event, and AI usage/errors in the dashboards. No historical client click counts can be backfilled from the retired request/page-view metrics.

See [runbook](observability-runbook.md) and [Grafana OpenTofu ownership](../architecture/grafana-opentofu.md).

## Engineering metrics

[Engineering metrics architecture](../architecture/engineering-metrics.md) defines counting/classification. GitHub refreshes every 15 minutes, independently of 15-second scrapes. `/metrics` reads the last complete in-memory snapshot without GitHub calls. Initial failure keeps the process healthy with `wotb_dev_collector_data_ready=0`; later failure preserves successful aggregates and timestamp. Restart reconstructs from GitHub; there is no database/cache backup.

Engineering Overview shows Healthy below 30 minutes since the last success, Delayed at 30–60 minutes and Stale at 60 minutes or more; no initial success is Not ready. Inspect process health/Prometheus UP separately from dataset readiness/age. GitHub outage does not imply Grafana runtime failure.

`DEV_METRICS_GITHUB_TOKEN` is repository-scoped read-only (Metadata, Pull requests, Issues, Actions, Contents read). The observability owner injects a protected runtime token file mounted read-only; only its path enters container configuration. Never put its value in images, Grafana JSON, OpenTofu state, argv, metrics, diagnostics or logs. Rotate via the same owner and redeploy. No public exporter port; Grafana remains authenticated only.

Configure this repository secret before selecting the exporter in `observability.yml`. The owner writes `/run/wotb-dev-metrics/github-token` under the existing Yecao deployment lock and recreates the container after rotation. `/run` is ephemeral: after a host reboot, dispatch Observability with scope `dev-metrics-exporter` to reinject the secret; a missing bind source fails closed instead of creating a directory. For a private GHCR package, the owner authenticates only the exporter pull with its short-lived publishing token, uses a temporary `/run` Docker config, and removes that config on success or failure. Exporter data access still uses the separate read-only token. No persistent host Docker login is required.

Rerunning the same source SHA reuses the existing exporter tag's digest. Only an absent tag is built; registry/authentication failures remain fatal. Both reused and newly built images must retain the expected OCI source revision and registry digest before staging, so a retry never overwrites an existing SHA tag.

`verify-observability.sh` checks exporter health, the `dev-metrics` Prometheus target and dataset readiness/age separately. An unavailable or stale GitHub snapshot prints `OBSERVABILITY DEGRADED [DEV_METRICS_DATA]` and continues the Grafana/Loki checks; it does not restart the exporter or skip unrelated runtime verification.

The monthly table shows historical event-date labels. The daily Created/Merged line chart converts day labels to UTC midnight through native Grafana transformations; its x-axis follows the picker. They do not invent pre-Prometheus sample history. Months start June 2026; days cover the latest 90 days. Instant bucket queries require a snapshot at the picker end; selecting an end outside observed Prometheus retention can return No data. Workflow snapshot/production trends follow the picker and existing seven-day retention. Never use `increase()`/`rate()` on reconstructed GitHub totals. Areas overlap, drafts overlap open, cancelled runs are not failures, and Actions retention can limit CI completeness. PR creation-to-merge is not DORA lead time. Release/workflow completion does not prove mutation: deployment/publish panels explicitly show Not available.

Activity is not productivity; production correlation does not establish causation. Links use the five real product dashboards. Production acceptance must compare live GitHub totals/months, prove successful refresh under 30 minutes, check safe diagnostics for leakage, apply only the additional dashboard, and require the existing clean second-plan/UID checks.

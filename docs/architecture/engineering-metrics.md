# Engineering metrics V1

GitHub (`A158Coke/WotbTools`) → Yecao `dev-metrics-exporter` → Prometheus → `WotbTools Engineering Overview` (`wotbtools-engineering-overview`). Existing Prometheus/Loki signals provide production context. OpenTofu owns dashboard API resources from Git JSON; file provisioning owns datasources. Grafana stays authenticated.

## Runtime and recovery

The Python exporter is an adapter/aggregator outside the TX request path. GitHub refreshes every 15 minutes; ordinary 15-second scrapes read a complete in-memory snapshot. `/health` proves process health; `collector_data_ready` and `collector_last_success_timestamp` prove dataset availability/age. Initial sync failure keeps the process alive and unready. Later refresh failure preserves the successful snapshot, increments errors and leaves the success timestamp unchanged. Restart reconstructs from GitHub. No PostgreSQL, SQLite, Redis or persistent raw-object store is introduced.

Yecao isolates API failure from product traffic. A Grafana GitHub datasource would couple rendering to API calls, credentials and classification logic; the exporter provides one bounded aggregate contract with observable failures. No database is needed because GitHub reconstructs state and Prometheus stores observed samples.

## Counting and history

PR state checks `merged_at` first; closed without it means closed-unmerged. Draft is an open subset. Merge rate is merged / (merged + closed-unmerged); empty denominator is undefined. Seven/thirty-day windows use event timestamps relative to refresh time. Snapshot P50/P90/P95 merge lead time means creation to merge, not DORA commit-to-production time. Empty populations have absent quantiles.

Backfill starts 2026-06-22. Month buckets remain from June 2026; days cover the latest 90 days. Event-date labels preserve reconstructed history even before Prometheus existed. The month table lists event buckets. The daily line chart uses native Grafana grouping-to-matrix, ISO8601 UTC time conversion and sorting to plot Created/Merged by event day against the picker axis; scrape timestamps are discarded. Each bucket sits at UTC midnight, so sub-day ranges clip by that timestamp and the current day is partial. This does not backdate TSDB samples. Instant queries need a snapshot at the picker end; outside observed Prometheus retention they can return No data. Current buckets are incomplete. Reconstructed counts, including names ending `_total`, are gauges: never apply `increase()`/`rate()`. Process error counters alone have counter semantics. Workflow trends show changes in cumulative snapshot ratios, not event throughput at scrape time.

Pagination covers PRs, workflow runs, releases and PR file lists. GitHub retention/deletion limits available CI history; V1 cannot prove complete workflow history since June. Required Gate uses the actual job, not a workflow-name proxy. Cancelled/skipped/other stay separate; success ratio divides success by success+failure. P50/P90 duration uses available completed gate jobs. GitHub releases are release publications only. Production deploy/publish panels remain Not available until stable evidence proves mutation.

## Classification and privacy

Areas: replay, playback, android, ai, frontend, backend, auth, infra, observability, docs, plus unclassified. Explicit supported `area/*` labels are authoritative; frozen historical overrides, changed paths and stable semantic fallbacks classify history. One PR can have several areas: bars overlap and do not represent effort shares. Frozen history is versioned in the exporter directory; heuristic edits must not silently reclassify it. New PRs should choose at least one supported label; CI is advisory.

The initial mapping freezes 608 PR classifications from the paginated GitHub file lists retrieved on 2026-10-16. It contains only PR numbers and area sets; file paths, titles and bodies are not stored. Feature-specific path rules preserve both the product area and its implementation layer (for example, playback inside frontend replay processing). Supported labels remain authoritative for explicit later corrections. Runtime caches retain classification/job aggregate contributions only and prune superseded PR updates/run attempts; they are rebuilt after restart.

Actor types human/agent/automation require reliable metadata or known identities. Unknown ordinary accounts remain human; AI text in a PR does not identify the actor. No per-developer/PR/title/SHA/email labels, ranking, LOC score or inferred AI productivity. Metrics contain aggregates only: no raw PR/comment bodies, private logs, token or secret information. Workflow identities and area/state/actor/conclusion/window/quantile/target labels are bounded; day/month labels follow the documented bucket cadence.

## Operations and security

The repository-scoped `DEV_METRICS_GITHUB_TOKEN` grants Metadata/Pull requests/Issues/Actions/Contents read only. Production injection supplies a protected read-only token file; the value never enters container environment, image, Grafana JSON, OpenTofu state, metrics or logs. No public port, host network or privileged container. The existing observability owner deploys an immutable SHA-related image, reconciles Prometheus and applies the saved Grafana plan; Komodo supplies visibility, never dashboard desired state.

Data age is Healthy below 30 minutes, Delayed at 30–60 minutes, Stale at 60 minutes or more; no initial sync is Not ready. Stale counts remain visible. Runtime and data freshness are distinct: GitHub outage must not restart a healthy process or invalidate healthy Grafana. Container recovery needs no persistent database.

Activity is not productivity. Production signals permit correlation, not automatic causation or incident attribution to a PR. The five real product dashboards remain drilldowns; retired dashboards are not recreated for links. GitHub is development truth, Prometheus/Loki own observed telemetry, Git owns configuration and OpenTofu owns Grafana desired state.

See [operations](../operations/observability.md) for production acceptance/retention and [Grafana ownership](grafana-opentofu.md) for IaC recovery.

## References

[Prometheus instrumentation guidance](https://prometheus.io/docs/practices/instrumentation/) explains gauge/counter selection, timestamp freshness and label costs. [GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) documents remaining/reset headers and primary/secondary limits.

[Grafana transformation documentation](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/query-transform-data/transform-data/) describes grouping to matrix and time-field conversion. The daily chart pipeline was executed with the deployed-version `@grafana/data` 11.6.16 implementation against an unsorted fixture; it preserves both counts, produces sorted UTC times and drops scrape timestamps.

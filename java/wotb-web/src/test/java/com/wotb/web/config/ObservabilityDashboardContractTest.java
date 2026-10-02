package com.wotb.web.config;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Deterministic guard for the production incident-debugging dashboard contract. */
class ObservabilityDashboardContractTest {

    private static final ObjectMapper OBJECT_MAPPER = JsonMapper.builder().build();
    private static final Set<String> REQUIRED_DASHBOARD_FILES = Set.of(
            "wotbtools-production-overview.json",
            "wotbtools-backend-overview.json",
            "wotbtools-error-explorer.json",
            "wotbtools-ai-review.json",
            "wotbtools-usage.json",
            "wotbtools-keycloak.json");
    private static final Set<String> REQUIRED_DASHBOARD_UIDS = Set.of(
            "wotbtools-production-overview",
            "wotbtools-backend-overview",
            "wotbtools-error-explorer",
            "wotbtools-ai-review",
            "wotbtools-usage",
            "wotbtools-keycloak");
    private static final Set<String> REMOVED_DASHBOARD_FILES = Set.of(
            "wotbtools-http-errors.json",
            "wotbtools-replay-parser.json",
            "wotbtools-android-downloads.json");
    private static final Set<String> REMOVED_TOFU_KEYS = Set.of(
            "wotbtools_http_errors",
            "wotbtools_replay_parser",
            "wotbtools_android_downloads");
    /**
     * AI 看板必须覆盖的生命周期事件 == 该看板查询的、在后端 main 源码中有生产者的事件。
     * 2026-10 legacy 契约收敛后，{@code team_review_parse_result} / {@code team_review_validation} /
     * {@code team_review_validation_conflict} / {@code ai_validation_retry} /
     * {@code team_review_validation_attempt_completed} 已无任何生产者；
     * {@code ai_review_started} / {@code ai_review_failed} / {@code ai_review_finished} 亦从无 emitter。
     * 两组都已从看板查询与本集合中移除，并由 forbidden 断言防止回归。
     */
    private static final Set<String> REQUIRED_AI_REVIEW_EVENTS = Set.of(
            "ai_review_contract_failed",
            "ai_review_recovery_triggered",
            "ai_review_recovery_failed",
            "team_review_completed");
    private static final Set<String> FORBIDDEN_PROMETHEUS_LABELS = Set.of(
            "correlationId", "errorId", "jobId", "accountId", "nickname", "filename");
    /** Micrometer Timer names gain a _seconds suffix in Prometheus exposition. */
    private static final Set<String> DERIVED_PROMETHEUS_METRICS = Set.of(
            "wotb_ai_review_queue_wait_seconds");

    @Test
    void dashboardInventoryIsExactlyTheSixApprovedDashboards() throws Exception {
        final Path dashboardDirectory = resolve("deploy", "observability", "grafana", "dashboards");
        final Set<String> actualFiles;
        try (Stream<Path> files = Files.list(dashboardDirectory)) {
            actualFiles = files.filter(path -> path.toString().endsWith(".json"))
                    .map(path -> path.getFileName().toString())
                    .collect(Collectors.toSet());
        }
        assertEquals(REQUIRED_DASHBOARD_FILES, actualFiles);

        final Set<String> actualUids = new HashSet<>();
        for (final String file : actualFiles) {
            final String uid = readDashboard(file).path("uid").asText();
            actualUids.add(uid);
            assertEquals(file.substring(0, file.length() - ".json".length()), uid,
                    "dashboard filename stem must equal its JSON uid: " + file);
        }
        assertEquals(REQUIRED_DASHBOARD_UIDS, actualUids);

        for (final String file : REMOVED_DASHBOARD_FILES) {
            assertFalse(Files.exists(dashboardDirectory.resolve(file)), "removed dashboard still exists: " + file);
        }
        final String tofu = Files.readString(resolve("infra", "tofu", "grafana", "dashboards.tf"));
        for (final String key : REMOVED_TOFU_KEYS) {
            assertFalse(tofu.contains(key), "removed OpenTofu dashboard key still exists: " + key);
        }
    }

    @Test
    void aiDashboardKeepsLifecycleQueriesAndLowCardinalityMetricBoundary() throws Exception {
        final JsonNode dashboard = readDashboard("wotbtools-ai-review.json");
        final String serialized = dashboard.toString();

        for (final String event : REQUIRED_AI_REVIEW_EVENTS) {
            assertTrue(serialized.contains(event), "AI Dashboard must cover " + event);
        }
        for (final String event : Set.of("ai_prompt_budget", "ai_upstream_call_failed")) {
            assertTrue(serialized.contains(event), "AI Dashboard must cover " + event);
        }
        assertTrue(serialized.contains("\"uid\":\"prometheus\""));
        assertTrue(serialized.contains("\"uid\":\"loki\""));
        assertTrue(hasVariable(dashboard, "correlationId"));
        assertTrue(serialized.contains("wotb_ai_team_review_validation_attempt_total"),
                "AI dashboard must retain the Team Call #2 contract result breakdown metric");
        assertTrue(serialized.contains("sum by (result)"),
                "Team Call #2 contract results must be broken down by the real result label");
        assertFalse(serialized.contains("|~ \"error|failed\""),
                "generic error-only Loki query must not replace lifecycle coverage");

        for (final JsonNode panel : dashboard.path("panels")) {
            if (!"prometheus".equals(panel.path("datasource").path("uid").asText())) {
                continue;
            }
            for (final JsonNode target : panel.path("targets")) {
                final String expression = target.path("expr").asText();
                for (final String label : FORBIDDEN_PROMETHEUS_LABELS) {
                    assertFalse(hasPrometheusLabel(expression, label),
                            "high-cardinality label in Prometheus query: " + label);
                }
            }
        }
    }

    @Test
    void schemaFailureBreakdownAggregatesExistingLowCardinalityMetric() throws Exception {
        final JsonNode panel = panel(readDashboard("wotbtools-ai-review.json"), "Schema 失败分类");
        assertTrue("table".equals(panel.path("type").asText()));
        assertTrue("prometheus".equals(panel.path("datasource").path("uid").asText()));
        final JsonNode target = panel.path("targets").path(0);
        final String expression = target.path("expr").asText();
        assertTrue(Boolean.TRUE.equals(target.path("instant").asBoolean()));
        assertTrue("table".equals(target.path("format").asText()));
        assertTrue(expression.contains("wotb_ai_team_review_schema_failure_total"));
        assertTrue(expression.contains("sum by (reason,path_class)"));
        assertTrue(expression.contains("reason"));
        assertTrue(expression.contains("path_class"));
    }

    @Test
    void dashboardUidParsingContractIsIndependentOfJsonFormatting() throws Exception {
        final JsonNode pretty = OBJECT_MAPPER.readTree("{\n  \"title\": \"Pretty\",\n  \"uid\": \"pretty-uid\",\n  \"version\": 1\n}");
        final JsonNode compact = OBJECT_MAPPER.readTree("{\"title\":\"Compact\",\"uid\":\"compact-uid\",\"version\":1}");
        assertEquals("pretty-uid", pretty.path("uid").asText());
        assertEquals("compact-uid", compact.path("uid").asText());
    }

    @Test
    void productionDashboardVerificationUsesCanonicalFilenamesWithoutJq() throws Exception {
        final String verifier = Files.readString(resolve("deploy", "verify-observability.sh"));
        assertFalse(verifier.contains("jq"), "production verifier must not require jq");
        assertTrue(verifier.contains("${dashboard_file##*/}"),
                "production verifier must derive dashboard UIDs from canonical filenames");
    }

    @Test
    void selectedRangeLokiAggregatesUseInstantQueries() throws Exception {
        final JsonNode errorCode = panel(readDashboard("wotbtools-error-explorer.json"), "错误码分布 · Loki");
        assertEquals("table", errorCode.path("type").asText());
        final JsonNode errorCodeTarget = errorCode.path("targets").path(0);
        assertEquals("instant", errorCodeTarget.path("queryType").asText());
        assertTrue(errorCodeTarget.path("expr").asText().contains("[$__range]"));

        final JsonNode usage = readDashboard("wotbtools-usage.json");
        for (final String title : Set.of("APK 下载次数（完整 200）", "续传 / Range 请求（206）",
                "APK 下载失败（4xx / 5xx）", "按 APK 版本统计（完整 200）")) {
            final JsonNode panel = panel(usage, title);
            assertEquals("instant", panel.path("targets").path(0).path("queryType").asText(), title);
            assertTrue(panel.path("targets").path(0).path("expr").asText().contains("[$__range]"), title);
        }

        final JsonNode trend = panel(usage, "APK 下载趋势");
        assertEquals("timeseries", trend.path("type").asText());
        assertEquals("short", trend.path("fieldConfig").path("defaults").path("unit").asText());
        for (final JsonNode target : trend.path("targets")) {
            assertEquals("range", target.path("queryType").asText());
            assertTrue(target.path("expr").asText().contains("count_over_time"));
        }
    }

    @Test
    void usageDashboardOwnsUsageAndAndroidMetricsOnly() throws Exception {
        final String usage = readDashboard("wotbtools-usage.json").toString();
        assertFalse(usage.contains("wotb_ai_review_results_total"));
        assertFalse(usage.contains("回放 / AI 结果趋势"));
        for (final String metric : Set.of(
                "wotb_ai_review_requests_total",
                "android_apk_download")) {
            assertTrue(usage.contains(metric), "Usage dashboard must retain " + metric);
        }

        final String aiReview = readDashboard("wotbtools-ai-review.json").toString();
        assertTrue(aiReview.contains("wotb_ai_review_results_total"));
    }

    /**
     * 服务器没有 parser：回放处理 Job（wotb-replay-processing / coordinator）已删除，
     * 其 {@code wotb_replay_processing_*} 指标不再有任何后端声明，看板不得继续引用。
     */
    @Test
    void dashboardsDoNotReferenceRemovedReplayProcessingMetrics() throws Exception {
        for (final String file : REQUIRED_DASHBOARD_FILES) {
            assertFalse(readDashboard(file).toString().contains("wotb_replay_processing_"),
                    "dashboard still references removed replay processing metrics: " + file);
        }
    }

    /**
     * Production Overview 的「生产状态」卡必须覆盖全部六类 target
     * （wotb-backend / ai-service / node-exporter / prometheus / loki / grafana），
     * 与 {@code deploy/AGENTS.md} 和 {@code deploy/verify-observability.sh} 的六类 gate 同口径。
     * 此前只算五类（缺 ai-service），ai-service 宕机不会反映到总健康卡。
     *
     * <p>刻意不在这里断言「Loki 查询标签必须指向真实 emitter 容器」：AI 生命周期事件由 Yecao
     * {@code ai-service} 产出，而仓库当前没有任何 Alloy 规则采集该容器；只按 {@code container_name}
     * 做标签交叉校验会命中确实有 Alloy 规则的 {@code wotb-backend} 标签并通过，属于虚假守护。
     * 该缺口以看板描述与 runbook 记录，待真正补上采集链路后再升级为断言。
     */
    @Test
    void productionOverviewHealthCardCoversEveryScrapedTargetClass() throws Exception {
        final JsonNode panel = panel(readDashboard("wotbtools-production-overview.json"),
                "生产状态（全部六类 target）");
        final String expression = panel.path("targets").path(0).path("expr").asText();
        for (final String job : Set.of("wotb-backend", "ai-service", "node-exporter",
                "prometheus", "loki", "grafana")) {
            assertTrue(expression.contains(job),
                    "Production Overview target-set card must cover job=" + job);
        }
        assertTrue(expression.contains("== 6"),
                "Production Overview target-set card must require all six targets");
        assertTrue(expression.contains("min(up"),
                "Production Overview target-set card must require min(up)==1");
    }

    @Test
    void schemaFailureRequestTraceIsChronologicalAndCorrelationScoped() throws Exception {
        final JsonNode dashboard = readDashboard("wotbtools-ai-review.json");
        final JsonNode panel = panel(dashboard, "Schema Failure Request Trace");
        assertTrue("logs".equals(panel.path("type").asText()));
        assertTrue("loki".equals(panel.path("datasource").path("uid").asText()));
        assertTrue("Ascending".equals(panel.path("options").path("sortOrder").asText()));
        final String query = panel.path("targets").path(0).path("expr").asText();
        assertTrue(query.contains("${correlationId:raw}"));
        for (final String event : Set.of("ai_review_contract_failed", "ai_review_recovery_triggered",
                "ai_review_recovery_failed", "team_review_completed")) {
            assertTrue(query.contains(event), "Request trace must cover " + event);
        }
        for (final String removed : Set.of("ai_review_started", "ai_review_failed", "ai_review_finished")) {
            assertFalse(dashboard.toString().contains(removed),
                    "Schema Failure Request Trace must not query producer-less event " + removed);
        }
    }

    @Test
    void contractDiagnosticsRetainsRecoveryAndUpstreamCoverage() throws Exception {
        final JsonNode dashboard = readDashboard("wotbtools-ai-review.json");
        final String query = panelQuery(dashboard, "AI 契约与上游诊断（按 correlationId）");
        // 2026-10 legacy 契约收敛后仅保留有生产者的 AI 事件；validation/parser 事件已删除。
        for (final String event : Set.of("ai_review_contract_failed", "ai_review_recovery_triggered",
                "ai_review_recovery_failed", "team_review_completed", "ai_prompt_budget",
                "ai_upstream_call_failed")) {
            assertTrue(query.contains(event), "AI contract diagnostics must cover " + event);
        }
        assertTrue(query.contains("${correlationId:raw}"));
    }

    @Test
    void prometheusQueriesReferenceMetricsDeclaredByBackend() throws Exception {
        final JsonNode dashboard = readDashboard("wotbtools-ai-review.json");
        final StringBuilder backendSources = new StringBuilder();
        // Metrics are declared by feature modules after the replay backend split, not only wotb-web.
        try (Stream<Path> files = Files.walk(resolve("java"))) {
            for (final Path file : files.filter(path -> path.toString().endsWith(".java")).toList()) {
                backendSources.append(Files.readString(file));
            }
        }

        final Set<String> metrics = new HashSet<>();
        final Matcher matcher = Pattern.compile("\\bwotb_[a-z0-9_]+").matcher(dashboard.toString());
        while (matcher.find()) {
            metrics.add(metricBase(matcher.group()));
        }
        for (final String metric : metrics) {
            assertTrue(backendSources.toString().contains(metric)
                            || DERIVED_PROMETHEUS_METRICS.contains(metric),
                    "dashboard metric is not declared by backend: " + metric);
        }
    }

    @Test
    void incidentExplorerSupportsApiAiAndReplayIdentifiersThroughLoki() throws Exception {
        final JsonNode dashboard = readDashboard("wotbtools-error-explorer.json");
        for (final String variable : Set.of("service", "correlationId", "errorId", "errorCode", "jobId")) {
            assertTrue(hasVariable(dashboard, variable), "missing incident variable: " + variable);
        }
        final String serialized = dashboard.toString();
        assertTrue(serialized.contains("api_request_failed"));
        assertTrue(serialized.contains("ai_review_contract_failed"));
        assertTrue(serialized.contains("ai_review_recovery_failed"));
        // 服务器没有 parser：processing-job 生命周期事件随服务端解析一起删除，看板不得再查询它们
        assertFalse(serialized.contains("processing_job_"), "retired processing-job events must not be queried");
        // 2026-10 legacy 契约收敛：Incident 生命周期只断言仍有生产者的事件
        // （validation/parser 系列已随 legacy 契约删除；ai_review_started/finished/failed/cancelled 从无 emitter）。
        for (final String event : Set.of(
                "ai_upstream_call_started", "ai_upstream_call_completed", "ai_upstream_call_failed",
                "ai_review_contract_failed", "ai_review_recovery_triggered", "ai_review_recovery_failed",
                "team_review_completed", "ai_prompt_budget", "api_request_failed",
                "api_request_rejected")) {
            assertTrue(serialized.contains(event), "Incident lifecycle must cover " + event);
        }
        for (final String removed : Set.of(
                "ai_review_sse_opened", "ai_review_sse_completed", "ai_review_started",
                "ai_review_finished", "ai_review_failed", "ai_review_cancelled",
                "team_review_parse_result", "team_review_validation",
                "team_review_validation_conflict", "team_review_validation_attempt_completed",
                "ai_validation_retry")) {
            assertFalse(serialized.contains(removed),
                    "Incident lifecycle must not query producer-less event " + removed);
        }
        assertTrue(serialized.contains("\"sortOrder\":\"Ascending\""),
                "single incident lifecycle must be chronological");
    }

    @Test
    void genericBackendLogsLiveOnlyInErrorExplorer() throws Exception {
        final Path dashboardDirectory = resolve("deploy", "observability", "grafana", "dashboards");
        for (final String file : REQUIRED_DASHBOARD_FILES) {
            if (file.equals("wotbtools-error-explorer.json")) {
                continue;
            }
            final String serialized = Files.readString(dashboardDirectory.resolve(file));
            assertFalse(serialized.contains("{container_name=\"wotb-backend\"} | json"),
                    "generic backend logs leaked into " + file);
            assertFalse(serialized.contains("level=~\"ERROR|WARN\""),
                    "generic level filter leaked into " + file);
        }
    }

    @Test
    void finalDashboardsHaveApprovedTitlesAndTimeRanges() throws Exception {
        assertEquals("WotBTools · 生产总览", readDashboard("wotbtools-production-overview.json").path("title").asText());
        assertEquals("now-1h", readDashboard("wotbtools-production-overview.json").path("time").path("from").asText());
        assertEquals("WotBTools · JVM 与基础设施", readDashboard("wotbtools-backend-overview.json").path("title").asText());
        assertEquals("WotBTools · HTTP 与事故诊断", readDashboard("wotbtools-error-explorer.json").path("title").asText());
        assertEquals("WotBTools · 回放与 AI 诊断", readDashboard("wotbtools-ai-review.json").path("title").asText());
        assertEquals("WotBTools · 使用统计与 Android", readDashboard("wotbtools-usage.json").path("title").asText());
        assertEquals("now-24h", readDashboard("wotbtools-usage.json").path("time").path("from").asText());
        assertEquals("WotBTools · Keycloak", readDashboard("wotbtools-keycloak.json").path("title").asText());
        assertFalse(readDashboard("wotbtools-ai-review.json").toString().contains("近期失败复盘"));
    }

    @Test
    void incidentIdentifierFiltersAreIndependentOptionalConstraints() throws Exception {
        final JsonNode dashboard = readDashboard("wotbtools-error-explorer.json");
        final String recentQuery = panelQuery(dashboard, "近期事故（倒序）");
        final String lifecycleQuery = panelQuery(dashboard, "单次 Incident 生命周期（按时间）");

        for (final String query : new String[]{recentQuery, lifecycleQuery}) {
            assertTrue(query.contains("|~ \"${errorId:raw}\""));
            assertTrue(query.contains("|~ \"${jobId:raw}\""));
            assertTrue(query.contains("|~ \"${correlationId:raw}\""));
            assertFalse(query.contains("jobId=${jobId:raw}|"),
                    "wildcard jobId must not bypass the errorId filter");
            assertFalse(query.contains("${errorId:raw})"),
                    "errorId must not be embedded in an OR identifier group");
        }

        // 样本日志行必须使用查询里真实存在的事件名，否则事件正则先失配，断言会退化为永真。
        assertFalse(matchesLokiTextFilters(recentQuery, "event=api_request_failed jobId=unrelated-job",
                "err-123", ".*", ".*", ".*"));
        assertFalse(matchesLokiTextFilters(recentQuery, "event=api_request_failed id=unrelated-error",
                ".*", "job-123", ".*", ".*"));
        assertFalse(matchesLokiTextFilters(lifecycleQuery, "event=ai_review_contract_failed correlationId=corr-other",
                ".*", ".*", "corr-123", ".*"));
        assertTrue(matchesLokiTextFilters(lifecycleQuery,
                "event=ai_review_contract_failed correlationId=corr-123", ".*", ".*", "corr-123", ".*"));
    }

    @Test
    void teamReviewLoggingContractIsInfoLevelAndDoesNotLogRawAiContent() throws Exception {
        final String source = Files.readString(resolve("java", "wotb-ai", "src", "main", "java",
                "com", "wotb", "web", "replay", "ai", "TeamReplayAnalysisService.java"));
        // 2026-10 legacy 契约收敛：validator 冲突事件、validation retry 事件及其指标已删除，
        // 此处改为守护收敛后真实存在的 v0.5 contract / salvage 日志与指标（断言数量与强度不变）。
        // 刻意不在此写出已删除的指标名：本文件会被 prometheusQueriesReferenceMetricsDeclaredByBackend
        // 当作“后端声明”全文扫描，写出旧名会让看板重新引用它时不再被拦下。
        assertTrue(source.contains("LOGGER.info(AiReviewEventLog.line(\"ai_review_contract_salvage_completed\""));
        assertFalse(source.contains("LOGGER.debug(AiReviewEventLog.line(\"ai_review_contract_salvage_completed\""));
        assertTrue(source.contains("\"failureCategory\", failureCategories(parsed)"));
        assertTrue(source.contains("wotb_ai_team_review_validation_attempt_total"));
        assertTrue(source.contains("countValidationAttempt(salvaged ? \"salvaged\" : \"pass\")"));
        assertTrue(source.contains("\"ai_review_contract_failed\""));
        assertTrue(source.contains("\"ai_review_contract_salvage_started\""));
        assertTrue(source.contains("\"team_review_grounding_ready\""));
        assertTrue(source.contains("\"team_review_completed\""));
    }

    private static JsonNode readDashboard(final String name) throws Exception {
        return OBJECT_MAPPER.readTree(Files.readString(resolve("deploy", "observability", "grafana",
                "dashboards", name)));
    }

    private static boolean hasVariable(final JsonNode dashboard, final String name) {
        for (final JsonNode variable : dashboard.path("templating").path("list")) {
            if (name.equals(variable.path("name").asText())) {
                return true;
            }
        }
        return false;
    }

    private static String panelQuery(final JsonNode dashboard, final String title) {
        return panel(dashboard, title).path("targets").path(0).path("expr").asText();
    }

    private static JsonNode panel(final JsonNode dashboard, final String title) {
        for (final JsonNode panel : dashboard.path("panels")) {
            if (title.equals(panel.path("title").asText())) {
                return panel;
            }
        }
        throw new AssertionError("Panel is missing: " + title);
    }

    private static boolean matchesLokiTextFilters(final String query, final String logLine,
                                                   final String errorId, final String jobId,
                                                   final String correlationId, final String errorCode) {
        final String interpolated = query
                .replace("${errorId:raw}", errorId)
                .replace("${jobId:raw}", jobId)
                .replace("${correlationId:raw}", correlationId)
                .replace("${errorCode:raw}", errorCode);
        final Matcher matcher = Pattern.compile("\\|~ \\\"([^\\\"]*)\\\"").matcher(interpolated);
        while (matcher.find()) {
            if (!Pattern.compile(matcher.group(1)).matcher(logLine).find()) {
                return false;
            }
        }
        return true;
    }

    private static String metricBase(final String metric) {
        for (final String suffix : new String[]{"_bucket", "_count", "_sum"}) {
            if (metric.endsWith(suffix)) {
                return metric.substring(0, metric.length() - suffix.length());
            }
        }
        return metric;
    }

    private static boolean hasPrometheusLabel(final String expression, final String label) {
        return expression.contains("{" + label + "=")
                || expression.contains("," + label + "=")
                || expression.contains("(" + label + ")")
                || expression.contains("," + label + ")");
    }

    private static Path resolve(final String... parts) {
        final Path relative = Path.of(parts[0], java.util.Arrays.copyOfRange(parts, 1, parts.length));
        Path current = Path.of("").toAbsolutePath().normalize();
        for (int depth = 0; depth < 8 && current != null; depth++) {
            final Path candidate = current.resolve(relative);
            if (Files.exists(candidate)) {
                return candidate;
            }
            current = current.getParent();
        }
        throw new AssertionError("Required observability file is missing: " + relative);
    }
}

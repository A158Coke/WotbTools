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
    private static final Set<String> REQUIRED_AI_REVIEW_EVENTS = Set.of(
            "ai_review_contract_failed",
            "ai_review_recovery_triggered",
            "ai_review_recovery_failed",
            "team_review_completed",
            "ai_review_failed",
            "ai_review_finished",
            "team_review_parse_result",
            "team_review_validation",
            "team_review_validation_conflict",
            "ai_validation_retry",
            "team_review_validation_attempt_completed");
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
            actualUids.add(readDashboard(file).path("uid").asText());
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
        for (final String event : Set.of("ai_prompt_budget", "ai_review_failed", "ai_review_cancelled",
                "ai_upstream_call_failed")) {
            assertTrue(serialized.contains(event), "AI Dashboard must cover " + event);
        }
        assertTrue(serialized.contains("\"uid\":\"prometheus\""));
        assertTrue(serialized.contains("\"uid\":\"loki\""));
        assertTrue(hasVariable(dashboard, "correlationId"));
        assertTrue(serialized.contains("TARGETED|FULL|SAFE"),
                "AI dashboard must distinguish all bounded validation rewrite stages");
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
    void schemaFailureRequestTraceIsChronologicalAndCorrelationScoped() throws Exception {
        final JsonNode dashboard = readDashboard("wotbtools-ai-review.json");
        final JsonNode panel = panel(dashboard, "Schema Failure Request Trace");
        assertTrue("logs".equals(panel.path("type").asText()));
        assertTrue("loki".equals(panel.path("datasource").path("uid").asText()));
        assertTrue("Ascending".equals(panel.path("options").path("sortOrder").asText()));
        final String query = panel.path("targets").path(0).path("expr").asText();
        assertTrue(query.contains("${correlationId:raw}"));
        for (final String event : Set.of("ai_review_contract_failed", "ai_review_recovery_triggered",
                "ai_review_recovery_failed", "team_review_completed", "ai_review_failed",
                "ai_review_finished")) {
            assertTrue(query.contains(event), "Request trace must cover " + event);
        }
    }

    @Test
    void validationDiagnosticsRetainsBroadParserValidatorAndUpstreamCoverage() throws Exception {
        final JsonNode dashboard = readDashboard("wotbtools-ai-review.json");
        final String query = panelQuery(dashboard, "AI Validation Diagnostics（按 correlationId）");
        for (final String event : Set.of("team_review_parse_result", "team_review_validation",
                "team_review_validation_conflict", "ai_validation_retry",
                "team_review_validation_attempt_completed", "ai_prompt_budget",
                "ai_upstream_call_failed", "ai_review_cancelled", "ai_review_contract_failed",
                "ai_review_recovery_triggered", "ai_review_recovery_failed", "team_review_completed",
                "ai_review_failed", "ai_review_finished")) {
            assertTrue(query.contains(event), "AI Validation Diagnostics must cover " + event);
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
        assertTrue(serialized.contains("ai_review_failed"));
        assertTrue(serialized.contains("team_review_validation_conflict"));
        assertTrue(serialized.contains("processing_job_failed"));
        for (final String event : Set.of(
                "ai_review_started", "ai_upstream_call_started", "ai_upstream_call_completed",
                "ai_upstream_call_failed", "team_review_parse_result", "team_review_validation",
                "team_review_validation_conflict", "team_review_validation_attempt_completed",
                "ai_validation_retry", "ai_review_contract_failed", "ai_review_recovery_triggered",
                "ai_review_recovery_failed", "team_review_completed", "ai_review_failed",
                "ai_review_finished", "ai_review_cancelled", "api_request_failed",
                "api_request_rejected", "processing_job_created", "processing_job_started",
                "processing_job_parse_done", "processing_job_source_failed", "processing_job_v2_error",
                "processing_job_ready", "processing_job_failed")) {
            assertTrue(serialized.contains(event), "Incident lifecycle must cover " + event);
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

        assertFalse(matchesLokiTextFilters(recentQuery, "event=ai_review_failed jobId=unrelated-job",
                "err-123", ".*", ".*", ".*"));
        assertFalse(matchesLokiTextFilters(recentQuery, "event=ai_review_failed id=unrelated-error",
                ".*", "job-123", ".*", ".*"));
        assertFalse(matchesLokiTextFilters(lifecycleQuery, "event=ai_review_started correlationId=corr-other",
                ".*", ".*", "corr-123", ".*"));
        assertTrue(matchesLokiTextFilters(lifecycleQuery,
                "event=ai_review_started correlationId=corr-123", ".*", ".*", "corr-123", ".*"));
    }

    @Test
    void teamReviewLoggingContractIsInfoLevelAndDoesNotLogRawAiContent() throws Exception {
        final String source = Files.readString(resolve("java", "wotb-ai", "src", "main", "java",
                "com", "wotb", "web", "replay", "ai", "TeamReplayAnalysisService.java"));
        assertTrue(source.contains("LOGGER.info(AiReviewEventLog.line(\"team_review_validation_conflict\""));
        assertFalse(source.contains("LOGGER.debug(AiReviewEventLog.line(\"team_review_validation_conflict\""));
        assertTrue(source.contains("\"rewrite\", rewrite"));
        assertTrue(source.contains("wotb_ai_team_review_validation_retry_total"));
        assertTrue(source.contains("case 4 -> \"SAFE\""));
        assertTrue(source.contains("\"team_review_parse_result\""));
        assertTrue(source.contains("\"team_review_validation\""));
        assertTrue(source.contains("\"team_review_validation_attempt_completed\""));
        assertTrue(source.contains("\"ai_validation_retry\""));
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

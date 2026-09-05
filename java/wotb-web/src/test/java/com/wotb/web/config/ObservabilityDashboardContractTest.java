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
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Deterministic guard for the production incident-debugging dashboard contract. */
class ObservabilityDashboardContractTest {

    private static final ObjectMapper OBJECT_MAPPER = JsonMapper.builder().build();
    private static final Set<String> REQUIRED_TEAM_EVENTS = Set.of(
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
    void aiDashboardKeepsLifecycleQueriesAndLowCardinalityMetricBoundary() throws Exception {
        final JsonNode dashboard = readDashboard("wotbtools-ai-review.json");
        final String serialized = dashboard.toString();

        for (final String event : REQUIRED_TEAM_EVENTS) {
            assertTrue(serialized.contains(event), "AI Dashboard must cover " + event);
        }
        for (final String event : Set.of("ai_prompt_budget", "ai_review_failed", "ai_review_cancelled",
                "ai_upstream_call_failed")) {
            assertTrue(serialized.contains(event), "AI Dashboard must cover " + event);
        }
        assertTrue(serialized.contains("\"uid\":\"prometheus\""));
        assertTrue(serialized.contains("\"uid\":\"loki\""));
        assertTrue(hasVariable(dashboard, "correlationId"));
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
    void prometheusQueriesReferenceMetricsDeclaredByBackend() throws Exception {
        final JsonNode dashboard = readDashboard("wotbtools-ai-review.json");
        final StringBuilder backendSources = new StringBuilder();
        try (Stream<Path> files = Files.walk(resolve("java", "wotb-web", "src", "main", "java"))) {
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
        assertTrue(serialized.contains("\"sortOrder\":\"Ascending\""),
                "single incident lifecycle must be chronological");
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
        final String source = Files.readString(resolve("java", "wotb-web", "src", "main", "java",
                "com", "wotb", "web", "replay", "ai", "TeamReplayAnalysisService.java"));
        assertTrue(source.contains("LOGGER.info(AiReviewEventLog.line(\"team_review_validation_conflict\""));
        assertFalse(source.contains("LOGGER.debug(AiReviewEventLog.line(\"team_review_validation_conflict\""));
        assertTrue(source.contains("\"rewrite\", rewrite"));
        assertTrue(source.contains("wotb_ai_team_review_validation_retry_total"));
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
        for (final JsonNode panel : dashboard.path("panels")) {
            if (title.equals(panel.path("title").asText())) {
                return panel.path("targets").path(0).path("expr").asText();
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

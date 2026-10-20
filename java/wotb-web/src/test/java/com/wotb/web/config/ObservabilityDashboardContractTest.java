package com.wotb.web.config;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Product-specific ownership and semantics; runtime smoke validates the Grafana API. */
class ObservabilityDashboardContractTest {
    private static final ObjectMapper JSON = JsonMapper.builder().build();
    private static final Set<String> UIDS = Set.of("wotbtools-active-users", "wotbtools-feature-usage",
            "wotbtools-android-downloads", "wotbtools-ai-token-usage", "wotbtools-backend-error-logs");
    private static final String ENGINEERING_UID = "wotbtools-engineering-overview";

    @Test
    void rebuiltDashboardsHaveUniqueIdentityAndTimeScope() throws Exception {
        final Path directory = resolve("deploy/observability/grafana/dashboards");
        try (Stream<Path> files = Files.list(directory)) {
            assertEquals(Stream.concat(UIDS.stream(), Stream.of(ENGINEERING_UID))
                            .map(uid -> uid + ".json").collect(Collectors.toSet()),
                    files.filter(path -> path.toString().endsWith(".json"))
                            .map(path -> path.getFileName().toString()).collect(Collectors.toSet()));
        }
        assertEquals(ENGINEERING_UID, dashboard(ENGINEERING_UID).path("uid").asText());
        for (final String uid : UIDS) {
            final JsonNode dashboard = dashboard(uid);
            assertEquals(uid, dashboard.path("uid").asText());
            assertEquals("Asia/Shanghai", dashboard.path("timezone").asText());
            assertEquals("now-24h", dashboard.path("time").path("from").asText());
            assertTrue(dashboard.path("panels").size() > 0);
            for (final JsonNode link : dashboard.path("links")) {
                assertTrue(UIDS.contains(link.path("url").asText().replace("/d/", "")));
            }
        }
    }

    @Test
    void activeUsersAreDeduplicatedAccountsRatherThanLoginEvents() throws Exception {
        final String query = query("wotbtools-active-users", "所选时间内活跃登录用户");
        assertTrue(query.contains("account_hash"));
        assertTrue(query.contains("telemetry_event=\"active_user\""));
        assertTrue(query.contains("sum by (account_hash)"));
        assertTrue(query.contains("[$__range]"));
        assertFalse(query.contains("LOGIN"));
    }

    @Test
    void downloadsCountOnlyFinalWebApkButtonClicks() throws Exception {
        final String total = query("wotbtools-android-downloads", "下载 APK 点击次数");
        assertTrue(total.contains("container_name=\"wotb-backend\""));
        assertTrue(total.contains("telemetry_event=\"android_download_click\""));
        assertTrue(total.contains("feature=\"android_download\""));
        assertTrue(total.contains("platform=\"web\""));
        assertFalse(total.contains("operation_id"));
        assertFalse(total.contains("android_apk_download"));
        assertFalse(total.contains("feature_open"));
        assertFalse(total.contains("status=\"200\""));
        assertFalse(total.contains("status=\"206\""));

        final JsonNode dashboard = dashboard("wotbtools-android-downloads");
        assertTrue(dashboard.path("description").asText().contains("click"));
        for (final JsonNode panel : dashboard.path("panels")) {
            assertFalse(panel.path("title").asText().contains("200"));
            assertFalse(panel.path("title").asText().contains("206"));
        }

        final String featureUsage = query("wotbtools-feature-usage", "功能打开次数");
        assertTrue(featureUsage.contains("feature != \"android_download\""));
    }

    @Test
    void aiTotalsAndPerReviewMeanUseDifferentAuthoritativeEvents() throws Exception {
        final String total = query("wotbtools-ai-token-usage", "已知总 token");
        final String average = query("wotbtools-ai-token-usage", "平均每次完成复盘 token");
        assertTrue(total.contains("ai_token_usage"));
        assertTrue(total.contains("unwrap totalTokens"));
        assertFalse(total.contains("cache"));
        assertTrue(average.contains("ai_review_usage"));
        assertTrue(average.contains("count_over_time"));
        assertFalse(average.contains("success_total"));
        assertTrue(query("wotbtools-ai-token-usage", "缺失 usage 调用数").contains("usageMissing"));
    }

    @Test
    void errorsAreOneDashboardWithFunctionalSectionsAndClientProvenance() throws Exception {
        final JsonNode errors = dashboard("wotbtools-backend-error-logs");
        assertEquals("Backend error logs", errors.path("title").asText());
        final Set<String> rows = Stream.iterate(0, i -> i < errors.path("panels").size(), i -> i + 1)
                .map(i -> errors.path("panels").path(i)).filter(p -> "row".equals(p.path("type").asText()))
                .map(p -> p.path("title").asText()).collect(Collectors.toSet());
        assertEquals(Set.of("账号与登录", "名人堂", "赛事积分", "AI 复盘", "回放解析错误（客户端上报）", "其他后端错误"), rows);
        assertTrue(query("wotbtools-backend-error-logs", "回放解析错误（客户端上报） · 日志")
                .contains("telemetry_event=replay_parse"));
    }

    @Test
    void retirementDoesNotRemoveSixTargetDataPathGate() throws Exception {
        final String prometheus = Files.readString(resolve("deploy/observability/prometheus/prometheus.yml"));
        for (final String job : Set.of("wotb-backend", "ai-service", "node-exporter", "prometheus", "loki", "grafana")) {
            assertTrue(prometheus.contains("job_name: " + job));
        }
        final String verifier = Files.readString(resolve("deploy/verify-observability.sh"));
        assertTrue(verifier.contains("wotbtools-active-users.json"));
    }

    private static String query(final String uid, final String title) throws Exception {
        for (final JsonNode panel : dashboard(uid).path("panels")) {
            if (title.equals(panel.path("title").asText())) {
                return panel.path("targets").path(0).path("expr").asText();
            }
        }
        throw new AssertionError("Missing panel: " + title);
    }

    private static JsonNode dashboard(final String uid) throws Exception {
        return JSON.readTree(Files.readString(resolve("deploy/observability/grafana/dashboards/" + uid + ".json")));
    }

    private static Path resolve(final String relative) {
        for (Path root = Path.of("").toAbsolutePath(); root != null; root = root.getParent()) {
            final Path candidate = root.resolve(relative);
            if (Files.exists(candidate)) {
                return candidate;
            }
        }
        throw new AssertionError("Repository file missing: " + relative);
    }
}

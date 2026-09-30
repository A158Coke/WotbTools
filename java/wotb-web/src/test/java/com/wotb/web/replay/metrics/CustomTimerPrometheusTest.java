package com.wotb.web.replay.metrics;

import io.micrometer.prometheusmetrics.PrometheusConfig;
import io.micrometer.prometheusmetrics.PrometheusMeterRegistry;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 验证自定义 Timer（ReplayUsageMetrics）在 Prometheus 注册表中真实产生
 * {@code _bucket}、{@code _count}、{@code _sum} 系列，从而保证 Grafana Dashboard
 * 的 P50/P95/P99（histogram_quantile）查询有真实数据支撑。
 *
 * AI Review 自有 Timer / 队列深度归属 wotb-ai，见
 * {@code com.wotb.web.replay.ai.AiReviewTimerPrometheusTest}。
 */
class CustomTimerPrometheusTest {

    @Test
    void replayUsageMetricsTimerProducesHistogramSeries() throws Exception {
        final PrometheusMeterRegistry registry = new PrometheusMeterRegistry(PrometheusConfig.DEFAULT);
        final ReplayUsageMetrics metrics = new ReplayUsageMetrics(registry);

        metrics.timed(ReplayUsageMetrics.OP_PREVIEW, 2, () -> {
            Thread.sleep(5);
            return null;
        });
        metrics.timed(ReplayUsageMetrics.OP_EXPORT, 1, () -> null);

        final String scrape = registry.scrape();
        // _count / _sum 必须存在
        assertTrue(scrape.contains("wotb_replay_parse_duration_seconds_count"),
                "missing _count series");
        assertTrue(scrape.contains("wotb_replay_parse_duration_seconds_sum"),
                "missing _sum series");
        // _bucket 系列必须存在（publishPercentileHistogram 启用）
        assertTrue(scrape.contains("wotb_replay_parse_duration_seconds_bucket"),
                "missing _bucket series: " + scrape.lines().limit(5).toList());

        // 请求量与文件数计数
        assertTrue(scrape.contains("wotb_replay_requests_total{operation=\"preview\"} 1"));
        assertTrue(scrape.contains("wotb_replay_files_total{operation=\"preview\"} 2"));
    }

    @Test
    void replayUsageMetricsTimerStopsOnFailure() throws Exception {
        final PrometheusMeterRegistry registry = new PrometheusMeterRegistry(PrometheusConfig.DEFAULT);
        final ReplayUsageMetrics metrics = new ReplayUsageMetrics(registry);

        boolean thrown = false;
        try {
            metrics.timed(ReplayUsageMetrics.OP_PREVIEW, 1, () -> {
                throw new IllegalStateException("boom");
            });
        } catch (final IllegalStateException e) {
            thrown = true;
        }
        assertTrue(thrown);
        final String scrape = registry.scrape();
        // 异常路径也结束 Timer（duration count=1）且 in-flight 归零
        assertTrue(scrape.contains("wotb_replay_parse_duration_seconds_count{operation=\"preview\"} 1"),
                "timer must stop on failure: " + scrape);
        assertTrue(scrape.contains("wotb_replay_in_flight 0"),
                "in-flight must return to 0 after failure: " + scrape);
    }
}

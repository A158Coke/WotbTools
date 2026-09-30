package com.wotb.web.replay.ai;

import io.micrometer.core.instrument.Timer;
import io.micrometer.prometheusmetrics.PrometheusConfig;
import io.micrometer.prometheusmetrics.PrometheusMeterRegistry;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 验证 AI Review 自有 Timer（review 时长 / upstream 时长 / 队列等待）在 Prometheus
 * 注册表中真实产生 histogram 系列，并验证 worker 队列深度 gauge，从而保证 Grafana
 * Dashboard 的 P50/P95/P99（histogram_quantile）查询有真实数据支撑。
 *
 * 与生产代码一致：必须通过 builder 启用 {@code publishPercentileHistogram}，否则无
 * {@code _bucket} 系列。业务归属 wotb-ai：这些 Timer 只由 AI Review 链路产出。
 */
class AiReviewTimerPrometheusTest {

    @Test
    void aiReviewTimerProducesHistogramSeries() {
        final PrometheusMeterRegistry registry = new PrometheusMeterRegistry(PrometheusConfig.DEFAULT);
        Timer.builder("wotb_ai_review_duration_seconds")
                .publishPercentileHistogram().register(registry)
                .record(Duration.ofMillis(50));
        Timer.builder("wotb_ai_upstream_duration_seconds")
                .publishPercentileHistogram().register(registry)
                .record(Duration.ofMillis(20));

        final String scrape = registry.scrape();
        assertTrue(scrape.contains("wotb_ai_review_duration_seconds_bucket"),
                "AI review timer must publish histogram buckets");
        assertTrue(scrape.contains("wotb_ai_upstream_duration_seconds_bucket"),
                "AI upstream timer must publish histogram buckets");
        assertEquals(1.0, registry.get("wotb_ai_review_duration_seconds").timer().count(),
                "AI review timer count must be 1");
    }

    @Test
    void aiReviewQueueWaitTimerProducesHistogramSeries() throws Exception {
        final PrometheusMeterRegistry registry = new PrometheusMeterRegistry(PrometheusConfig.DEFAULT);
        final CountDownLatch firstTaskStarted = new CountDownLatch(1);
        final CountDownLatch releaseFirstTask = new CountDownLatch(1);
        final CountDownLatch queuedTaskFinished = new CountDownLatch(1);

        try (AiReviewWorkerExecutor executor = new AiReviewWorkerExecutor(1, 1, 10, registry)) {
            executor.execute(() -> {
                firstTaskStarted.countDown();
                try {
                    releaseFirstTask.await(2, TimeUnit.SECONDS);
                } catch (final InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
            assertTrue(firstTaskStarted.await(2, TimeUnit.SECONDS), "first worker task did not start");

            executor.execute(queuedTaskFinished::countDown);
            assertEquals(1.0, registry.get("wotb_ai_review_queue_depth").gauge().value(),
                    "AI review queue depth must expose the queued task");
            Thread.sleep(25);
            releaseFirstTask.countDown();
            assertTrue(queuedTaskFinished.await(2, TimeUnit.SECONDS), "queued worker task did not finish");
        }

        final String scrape = registry.scrape();
        assertTrue(scrape.contains("wotb_ai_review_queue_wait_seconds_bucket"),
                "AI queue wait timer must publish histogram buckets");
        assertTrue(scrape.contains("wotb_ai_review_queue_wait_seconds_count"),
                "AI queue wait timer must publish a count series");
    }

    /**
     * {@code wotb_ai_review_in_flight} 是生产告警/看板的饱和信号（Grafana
     * "AI 执行中"/"AI 当前并发" 与 {@code deploy/verify-observability.sh} 的必需指标），
     * 必须只统计“已进入 worker 且尚未完成”的请求。
     */
    @Test
    void aiReviewInFlightGaugeTracksExecutingReviews() throws Exception {
        final PrometheusMeterRegistry registry = new PrometheusMeterRegistry(PrometheusConfig.DEFAULT);
        final CountDownLatch started = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        final CountDownLatch finished = new CountDownLatch(1);

        try (AiReviewWorkerExecutor executor = new AiReviewWorkerExecutor(1, 4, 10, registry)) {
            executor.execute(() -> {
                started.countDown();
                try {
                    release.await(2, TimeUnit.SECONDS);
                } catch (final InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    finished.countDown();
                }
            });
            assertTrue(started.await(2, TimeUnit.SECONDS), "worker task did not start");
            assertEquals(1.0, registry.get("wotb_ai_review_in_flight").gauge().value(),
                    "in-flight gauge must count the executing review");

            release.countDown();
            assertTrue(finished.await(2, TimeUnit.SECONDS), "worker task did not finish");
        }

        assertTrue(registry.scrape().contains("wotb_ai_review_in_flight"),
                "in-flight gauge must be exported to Prometheus");
    }
}

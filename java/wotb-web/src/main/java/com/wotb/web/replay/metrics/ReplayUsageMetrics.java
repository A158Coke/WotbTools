package com.wotb.web.replay.metrics;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 回放解析功能使用指标（低基数、固定 operation 枚举）。
 * <p>
 * 指标：
 * <ul>
 *   <li>{@code wotb_replay_requests_total{operation}} — 请求量</li>
 *   <li>{@code wotb_replay_files_total{operation}} — 解析文件数</li>
 *   <li>{@code wotb_replay_parse_duration_seconds{operation}} — 解析耗时（Timer，成功与异常都结束）</li>
 *   <li>{@code wotb_replay_in_flight} — 当前处理中的解析请求数（Gauge）</li>
 * </ul>
 * operation 取值见 {@link #OP_PREVIEW} 等常量（单一来源，调用方必须引用常量而非硬编码字符串）。
 * 单元测试中 MeterRegistry 为 null 时原样执行，不做任何记录。
 */
@Component
public class ReplayUsageMetrics {

    public static final String OP_PREVIEW = "preview";
    public static final String OP_EXPORT = "export";
    public static final String OP_RATING = "rating";
    public static final String OP_PROCESS = "process";
    public static final String OP_RECONSTRUCT = "reconstruct";
    public static final String OP_AI_REVIEW = "ai_review";

    private final MeterRegistry meterRegistry;
    private final AtomicInteger inFlight = new AtomicInteger();

    public ReplayUsageMetrics(@Autowired(required = false) final MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
        if (meterRegistry != null) {
            Gauge.builder("wotb_replay_in_flight", inFlight, AtomicInteger::get)
                    .description("当前正在处理的回放解析请求数")
                    .register(meterRegistry);
        }
    }

    /**
     * 执行并统计一次回放解析：请求量+1、文件数累计、耗时。
     * 成功与异常路径都会正确结束 Timer 与 in-flight 计数。
     * 注意：不统计 success/failure——解析失败以 ReplayProcessingResult.status=FAILED 返回而非抛异常，
     * 异常判定不可靠，见 docs/operations/observability.md。
     */
    public <T> T timed(final String operation, final int fileCount, final Callable<T> body) throws Exception {
        if (meterRegistry == null) {
            return body.call();
        }
        inFlight.incrementAndGet();
        counter("wotb_replay_requests_total", operation).increment();
        if (fileCount > 0) {
            counter("wotb_replay_files_total", operation).increment(fileCount);
        }
        final Timer.Sample sample = Timer.start(meterRegistry);
        try {
            return body.call();
        } finally {
            // 成功与异常路径都结束 Timer 并递减 in-flight
            sample.stop(timer(operation));
            inFlight.decrementAndGet();
        }
    }

    private Counter counter(final String name, final String operation) {
        return meterRegistry.counter(name, "operation", operation);
    }

    private Timer timer(final String operation) {
        return Timer.builder("wotb_replay_parse_duration_seconds")
                .description("回放解析与处理耗时")
                .tag("operation", operation)
                .publishPercentileHistogram()
                .register(meterRegistry);
    }
}

package com.wotb.web.replay.job;

import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 有界 Export Job worker executor（模式对齐 {@code AiReviewWorkerExecutor}）。
 *
 * <p>容量设计（V1：2C4G VPS）：固定 {@code max-concurrent}（默认 2，与
 * {@code ReplayCapacityLimiter} 同值）worker + 有界队列（默认 4），满载抛
 * {@code RejectedExecutionException}（AbortPolicy），由服务层转 503
 * {@code EXPORT_QUEUE_FULL}。worker 在执行时仍会获取全局
 * {@code ReplayCapacityLimiter} 许可（plan §21：HTTP 异步化不能绕过全局容量）。</p>
 */
@Component
public class ReplayExportWorkerExecutor implements AutoCloseable {

    static final int DEFAULT_MAX_CONCURRENT = 2;
    static final int DEFAULT_QUEUE_CAPACITY = 4;

    private final ThreadPoolExecutor executor;

    @Autowired
    public ReplayExportWorkerExecutor(
            @Value("${wotb.replay.export-job.max-concurrent:2}") final int maxConcurrent,
            @Value("${wotb.replay.export-job.queue-capacity:4}") final int queueCapacity) {
        if (maxConcurrent < 1) {
            throw new IllegalArgumentException("export-job max-concurrent must be >= 1: " + maxConcurrent);
        }
        if (queueCapacity < 1) {
            throw new IllegalArgumentException("export-job queue-capacity must be >= 1: " + queueCapacity);
        }
        this.executor = new ThreadPoolExecutor(
                maxConcurrent,
                maxConcurrent,
                0L,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(queueCapacity),
                new NamedDaemonThreadFactory(),
                new ThreadPoolExecutor.AbortPolicy());
    }

    /** 测试便利构造器：默认 2/4。 */
    public ReplayExportWorkerExecutor() {
        this(DEFAULT_MAX_CONCURRENT, DEFAULT_QUEUE_CAPACITY);
    }

    /** 提交任务；workers + queue 满载抛 {@code RejectedExecutionException}（AbortPolicy）。 */
    public void execute(final Runnable task) {
        executor.execute(task);
    }

    @PreDestroy
    @Override
    public void close() {
        executor.shutdown();
    }

    private static final class NamedDaemonThreadFactory implements ThreadFactory {
        private final AtomicInteger counter = new AtomicInteger();

        @Override
        public Thread newThread(final Runnable runnable) {
            final Thread thread = new Thread(runnable, "wotb-export-job-worker-" + counter.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        }
    }
}

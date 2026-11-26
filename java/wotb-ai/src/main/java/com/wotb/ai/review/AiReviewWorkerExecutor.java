package com.wotb.ai.review;

import com.wotb.ai.gateway.AiRequestContext;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

@Component
public class AiReviewWorkerExecutor implements AutoCloseable {

    private static final Logger LOGGER = LoggerFactory.getLogger(AiReviewWorkerExecutor.class);

    static final int DEFAULT_MAX_CONCURRENT = 4;
    static final int DEFAULT_QUEUE_CAPACITY = 4;
    static final long DEFAULT_OVERALL_DEADLINE_SEC = 1100;

    private final ExecutorService executor;
    private final ThreadPoolExecutor platformExecutor;
    private final Semaphore activePermits;
    private final Semaphore admissionPermits;
    private final AtomicInteger virtualQueueDepth;
    private final AtomicBoolean closed = new AtomicBoolean();
    private final AtomicInteger inFlight = new AtomicInteger();
    private final boolean virtualThreads;
    private final long overallDeadlineNanos;
    private final MeterRegistry meterRegistry;

    /**
     * Spring 构造器：从 {@code wotb.ai.review-worker.max-concurrent} /
     * {@code wotb.ai.review-worker.queue-capacity} /
     * {@code wotb.ai.review-worker.overall-deadline-sec} /
     * {@code wotb.ai.review-worker.virtual-threads} 读取配置（默认 4/4/1100/true）。
     * 测试可直接传字面值调用（{@code @Value} 仅 Spring 容器处理）。
     *
     * @param maxConcurrent    active upstream-call limit; platform mode uses this as worker count
     * @param queueCapacity    有界队列容量，必须 ≥ 1
     * @param overallDeadlineSec  请求整体 deadline（秒），必须 ≥ 1
     * @param virtualThreads   是否使用虚拟线程执行阻塞的上游 AI 调用
     * @param meterRegistry    可选 Micrometer 注册表（运行时缺失时为 {@code null}，跳过指标记录）
     */
    @Autowired
    public AiReviewWorkerExecutor(
            @Value("${wotb.ai.review-worker.max-concurrent:4}") final int maxConcurrent,
            @Value("${wotb.ai.review-worker.queue-capacity:4}") final int queueCapacity,
            @Value("${wotb.ai.review-worker.overall-deadline-sec:1100}") final long overallDeadlineSec,
            @Value("${wotb.ai.review-worker.virtual-threads:true}") final boolean virtualThreads,
            @Autowired(required = false) final MeterRegistry meterRegistry) {
        if (maxConcurrent < 1) {
            throw new IllegalArgumentException(
                    "maxConcurrent must be >= 1: " + maxConcurrent);
        }
        if (queueCapacity < 1) {
            throw new IllegalArgumentException(
                    "queueCapacity must be >= 1: " + queueCapacity);
        }
        if (overallDeadlineSec < 1) {
            throw new IllegalArgumentException(
                    "overallDeadlineSec must be >= 1: " + overallDeadlineSec);
        }
        this.overallDeadlineNanos = TimeUnit.SECONDS.toNanos(overallDeadlineSec);
        this.virtualThreads = virtualThreads;
        if (virtualThreads) {
            this.platformExecutor = null;
            this.executor = Executors.newThreadPerTaskExecutor(
                    Thread.ofVirtual().name("wotb-ai-review-vt-", 1).factory());
            this.activePermits = new Semaphore(maxConcurrent, true);
            this.admissionPermits = new Semaphore(Math.addExact(maxConcurrent, queueCapacity), true);
            this.virtualQueueDepth = new AtomicInteger();
        } else {
            this.platformExecutor = new ThreadPoolExecutor(
                    maxConcurrent,
                    maxConcurrent,
                    0L,
                    TimeUnit.MILLISECONDS,
                    new ArrayBlockingQueue<>(queueCapacity),
                    new NamedPlatformThreadFactory(),
                    new ThreadPoolExecutor.AbortPolicy());
            this.executor = platformExecutor;
            this.activePermits = null;
            this.admissionPermits = null;
            this.virtualQueueDepth = null;
        }
        this.meterRegistry = meterRegistry;
        if (meterRegistry != null) {
            Gauge.builder("wotb_ai_review_queue_depth", this, AiReviewWorkerExecutor::queueDepth)
                    .description("当前等待执行的 AI Review worker 数")
                    .register(meterRegistry);
            Gauge.builder("wotb_ai_review_in_flight", inFlight, AtomicInteger::get)
                    .description("当前已进入 worker 且尚未完成的 AI Review 数（不含排队等待）")
                    .register(meterRegistry);
        }
    }

    public AiReviewWorkerExecutor() {
        this(DEFAULT_MAX_CONCURRENT, DEFAULT_QUEUE_CAPACITY, DEFAULT_OVERALL_DEADLINE_SEC,
                true, null);
    }

    public AiReviewWorkerExecutor(final int maxConcurrent, final int queueCapacity) {
        this(maxConcurrent, queueCapacity, DEFAULT_OVERALL_DEADLINE_SEC, true, null);
    }

    public AiReviewWorkerExecutor(final int maxConcurrent, final int queueCapacity,
                                  final long overallDeadlineSec,
                                  final MeterRegistry meterRegistry) {
        this(maxConcurrent, queueCapacity, overallDeadlineSec, true, meterRegistry);
    }

    public void execute(final Runnable task) {
        final long submittedNanos = System.nanoTime();
        if (closed.get()) {
            throw new RejectedExecutionException("AI review worker is shut down");
        }
        if (!virtualThreads) {
            executor.execute(() -> runTask(task, submittedNanos));
            return;
        }

        if (!admissionPermits.tryAcquire()) {
            throw new RejectedExecutionException("AI review worker admission is full or shut down");
        }
        if (closed.get()) {
            admissionPermits.release();
            throw new RejectedExecutionException("AI review worker is shut down");
        }
        virtualQueueDepth.incrementAndGet();
        try {
            executor.execute(() -> runVirtualTask(task, submittedNanos));
        } catch (final RejectedExecutionException error) {
            virtualQueueDepth.decrementAndGet();
            admissionPermits.release();
            throw error;
        }
    }

    @PreDestroy
    @Override
    public void close() {
        if (closed.compareAndSet(false, true)) {
            executor.shutdown();
        }
    }

    public boolean awaitTermination(final long timeout, final TimeUnit unit)
            throws InterruptedException {
        return executor.awaitTermination(timeout, unit);
    }

    private int queueDepth() {
        return virtualThreads ? virtualQueueDepth.get() : platformExecutor.getQueue().size();
    }

    private void runVirtualTask(final Runnable task, final long submittedNanos) {
        boolean active = false;
        try {
            activePermits.acquireUninterruptibly();
            active = true;
            virtualQueueDepth.decrementAndGet();
            runTask(task, submittedNanos);
        } finally {
            if (!active) {
                virtualQueueDepth.decrementAndGet();
            } else {
                activePermits.release();
            }
            admissionPermits.release();
        }
    }

    private void runTask(final Runnable task, final long submittedNanos) {
        final long startNanos = System.nanoTime();
        final long queueWaitMillis = (startNanos - submittedNanos) / 1_000_000L;
        if (queueWaitMillis > 0) {
            LOGGER.debug("AI review worker queue wait {} ms (overall deadline {} s)",
                    queueWaitMillis, TimeUnit.NANOSECONDS.toSeconds(overallDeadlineNanos));
            if (meterRegistry != null) {
                Timer.builder("wotb_ai_review_queue_wait")
                        .publishPercentileHistogram()
                        .register(meterRegistry)
                        .record(startNanos - submittedNanos, TimeUnit.NANOSECONDS);
            }
        }
        inFlight.incrementAndGet();
        AiRequestContext.setOverallDeadline(submittedNanos + overallDeadlineNanos);
        try {
            task.run();
        } finally {
            AiRequestContext.clearOverallDeadline();
            inFlight.decrementAndGet();
        }
    }

    private static final class NamedPlatformThreadFactory implements ThreadFactory {
        private final AtomicInteger counter = new AtomicInteger();

        @Override
        public Thread newThread(final Runnable runnable) {
            final Thread thread = new Thread(runnable, "wotb-ai-review-pt-" + counter.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        }
    }
}

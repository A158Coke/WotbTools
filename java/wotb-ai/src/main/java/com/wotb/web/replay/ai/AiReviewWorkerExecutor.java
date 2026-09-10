package com.wotb.web.replay.ai;

import com.wotb.web.replay.ai.gateway.AiRequestContext;
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

/**
 * 有界 AI Review / SSE worker executor：{@code ReconstructionController.analyze()}
 * 在 servlet request 线程只做校验与提交，真正的 AI 复盘（含上游流式调用）在
 * 此执行器的 worker 线程上运行，request 线程立即返回 {@code SseEmitter}。
 *
 * <p><b>容量设计（V1：2C4G VPS）</b>：默认 4 concurrent workers + 4 queued，
 * 最多 8 active/pending，第 9 个请求立即拒绝（{@code AI_REVIEW_BUSY} / 503）。
 * 可通过环境变量 {@code AI_REVIEW_WORKER_MAX_CONCURRENT} /
 * {@code AI_REVIEW_WORKER_QUEUE_CAPACITY} 调整（3/4/6 等无需 rebuild）。
 * 平台线程模式使用固定 worker + 有界队列；虚拟线程模式则为每个已接纳的
 * task 创建一个虚拟线程，并用独立 admission/active permits 保留相同的
 * {@code maxConcurrent + queueCapacity} backpressure。</p>
 *
 * <p><b>拒绝策略</b>：{@link ThreadPoolExecutor.AbortPolicy}——满载时抛
 * {@code RejectedExecutionException}，由 Controller 捕获后返回 503
 * {@code AI_REVIEW_BUSY}。绝不使用 {@code CallerRunsPolicy}（会让 servlet
 * request 线程执行 AI Review，重新引入 SSE blocking bug）。</p>
 *
 * <p><b>整体 deadline（E）</b>：请求在提交时刻计算 {@code now + overall-deadline-sec}
 * （默认 1100s，覆盖团队 3 次 AI 调用（Call #1 + Call #2 + Autopsy，每次 ≤315s）
 * 加余量；对齐前端 1100s / nginx 1120s），经 {@link AiRequestContext} 暴露给
 * worker；排队等待计入剩余预算，启动时预算耗尽直接干净失败 {@code AI_TIMEOUT}。</p>
 */
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
        }
    }

    /** 测试便利构造器：使用默认 4/4/1100。 */
    public AiReviewWorkerExecutor() {
        this(DEFAULT_MAX_CONCURRENT, DEFAULT_QUEUE_CAPACITY, DEFAULT_OVERALL_DEADLINE_SEC,
                true, null);
    }

    /** 测试便利构造器：指定 workers/queue，整体 deadline 用默认 1100s。 */
    public AiReviewWorkerExecutor(final int maxConcurrent, final int queueCapacity) {
        this(maxConcurrent, queueCapacity, DEFAULT_OVERALL_DEADLINE_SEC, true, null);
    }

    /** 测试/显式装配便利构造器：可选择平台线程或虚拟线程。 */
    public AiReviewWorkerExecutor(final int maxConcurrent, final int queueCapacity,
                                  final long overallDeadlineSec,
                                  final MeterRegistry meterRegistry) {
        this(maxConcurrent, queueCapacity, overallDeadlineSec, true, meterRegistry);
    }

    /**
     * 提交任务；当 workers + queue 全满时抛 {@code RejectedExecutionException}
     * （AbortPolicy），由调用方捕获并返回 503 {@code AI_REVIEW_BUSY}。
     *
     * <p>提交时刻即计算整体 deadline（now + overall-deadline-sec），经
     * {@link AiRequestContext} 暴露给 worker；排队等待计入剩余预算，
     * 启动时预算耗尽由服务层直接抛 {@code AI_TIMEOUT}。</p>
     */
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

    /** Waits for already admitted work to finish; useful for deterministic benchmark teardown. */
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
        AiRequestContext.setOverallDeadline(submittedNanos + overallDeadlineNanos);
        try {
            task.run();
        } finally {
            AiRequestContext.clearOverallDeadline();
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

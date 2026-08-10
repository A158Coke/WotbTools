package com.wotb.web.replay.ai;

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
 * 有界 AI Review / SSE worker executor：{@code ReconstructionController.analyze()}
 * 在 servlet request 线程只做校验与提交，真正的 AI 复盘（含上游流式调用）在
 * 此执行器的 worker 线程上运行，request 线程立即返回 {@code SseEmitter}。
 *
 * <p><b>容量设计（V1：2C4G VPS）</b>：默认 4 concurrent workers + 4 queued，
 * 最多 8 active/pending，第 9 个请求立即拒绝（{@code AI_REVIEW_BUSY} / 503）。
 * 可通过环境变量 {@code AI_REVIEW_WORKER_MAX_CONCURRENT} /
 * {@code AI_REVIEW_WORKER_QUEUE_CAPACITY} 调整（3/4/6 等无需 rebuild）。
 * 线程数固定（core = max），daemon，有界队列。</p>
 *
 * <p><b>拒绝策略</b>：{@link ThreadPoolExecutor.AbortPolicy}——满载时抛
 * {@code RejectedExecutionException}，由 Controller 捕获后返回 503
 * {@code AI_REVIEW_BUSY}。绝不使用 {@code CallerRunsPolicy}（会让 servlet
 * request 线程执行 AI Review，重新引入 SSE blocking bug）。</p>
 */
@Component
public class AiReviewWorkerExecutor implements AutoCloseable {

    static final int DEFAULT_MAX_CONCURRENT = 4;
    static final int DEFAULT_QUEUE_CAPACITY = 4;

    private final ThreadPoolExecutor executor;

    /**
     * Spring 构造器：从 {@code wotb.ai.review-worker.max-concurrent} /
     * {@code wotb.ai.review-worker.queue-capacity} 读取配置（默认 4/4）。
     * 测试可直接传字面值调用（{@code @Value} 仅 Spring 容器处理）。
     *
     * @param maxConcurrent  worker 线程数（core = max，固定不弹性伸缩），必须 ≥ 1
     * @param queueCapacity  有界队列容量，必须 ≥ 1
     */
    @Autowired
    public AiReviewWorkerExecutor(
            @Value("${wotb.ai.review-worker.max-concurrent:4}") final int maxConcurrent,
            @Value("${wotb.ai.review-worker.queue-capacity:4}") final int queueCapacity) {
        if (maxConcurrent < 1) {
            throw new IllegalArgumentException(
                    "maxConcurrent must be >= 1: " + maxConcurrent);
        }
        if (queueCapacity < 1) {
            throw new IllegalArgumentException(
                    "queueCapacity must be >= 1: " + queueCapacity);
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

    /** 测试便利构造器：使用默认 4/4。 */
    public AiReviewWorkerExecutor() {
        this(DEFAULT_MAX_CONCURRENT, DEFAULT_QUEUE_CAPACITY);
    }

    /**
     * 提交任务；当 workers + queue 全满时抛 {@code RejectedExecutionException}
     * （AbortPolicy），由调用方捕获并返回 503 {@code AI_REVIEW_BUSY}。
     */
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
            final Thread thread = new Thread(runnable, "wotb-ai-review-worker-" + counter.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        }
    }
}

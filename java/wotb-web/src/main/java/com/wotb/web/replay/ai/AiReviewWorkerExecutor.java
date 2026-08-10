package com.wotb.web.replay.ai;

import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionHandler;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 有界 AI Review / SSE worker executor：{@code ReconstructionController.analyze()}
 * 在 servlet request 线程只做校验与提交，真正的 AI 复盘（含上游流式调用）在
 * 此执行器的 worker 线程上运行，request 线程立即返回 {@code SseEmitter}。
 *
 * <p>规模选择（有界、明确）：核心线程 = min(8, 2×CPU)，最大 16，工作队列
 * 有界（32 个 {@link ArrayBlockingQueue}），线程均为 daemon。过载时采用
 * {@link ThreadPoolExecutor.CallerRunsPolicy}：极端并发下退化为提交线程执行，
 * 宁可暂时阻塞一个请求也绝不丢弃复盘任务。空闲核心线程自动回收。</p>
 */
@Component
public class AiReviewWorkerExecutor implements AutoCloseable {

    private static final long KEEP_ALIVE_SEC = 60L;
    private static final int QUEUE_CAPACITY = 32;
    private static final int MAX_POOL_SIZE = 16;

    private final ThreadPoolExecutor executor;

    public AiReviewWorkerExecutor() {
        final int cores = Runtime.getRuntime().availableProcessors();
        final int corePoolSize = Math.max(2, Math.min(8, cores));
        this.executor = new ThreadPoolExecutor(
                corePoolSize,
                MAX_POOL_SIZE,
                KEEP_ALIVE_SEC,
                TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(QUEUE_CAPACITY),
                new NamedDaemonThreadFactory(),
                new ThreadPoolExecutor.CallerRunsPolicy());
        this.executor.allowCoreThreadTimeOut(true);
    }

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

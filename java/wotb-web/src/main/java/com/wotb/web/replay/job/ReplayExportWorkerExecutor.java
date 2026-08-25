package com.wotb.web.replay.job;

import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 有界 Export Job worker executor（模式对齐 {@code AiReviewWorkerExecutor}）。
 *
 * <p>容量设计（V1：2C4G VPS）：固定 {@code max-concurrent}（默认 1，与
 * {@code REPLAY_ARTIFACT_MAX_CONCURRENT} 同值）worker + 有界队列（默认 4），满载抛
 * {@code RejectedExecutionException}（AbortPolicy），由服务层转 503
 * {@code EXPORT_QUEUE_FULL}。BLOCKER 2 后 Export 只消费 Processing Job dataset
 * （无 replay processing），不再获取全局 replay 容量许可——解析 CPU 预算唯一权威是
 * {@code ReplayParseScheduler}。</p>
 *
 * <p><b>QUEUED 取消（PR #118 Blocker A）</b>：{@link #submit(String, Runnable)} 保存
 * jobId → 实际提交的 Runnable 句柄；{@link #removeQueued(String)} 用
 * {@link ThreadPoolExecutor#remove(Runnable)} 把尚未开始执行的 FutureTask 从有界队列
 * 移除，立即释放 queue slot（新 job 可马上使用该容量），并保证 worker 绝不会再执行
 * 已取消的任务。任务已 dequeue/开始执行时 remove 返回 {@code false}，由协作取消接管
 * （runJob 的 checkpoint 识别 cancelRequested 后终态）。</p>
 */
@Component
public class ReplayExportWorkerExecutor implements AutoCloseable {

    static final int DEFAULT_MAX_CONCURRENT = 1;
    static final int DEFAULT_QUEUE_CAPACITY = 4;

    private final ThreadPoolExecutor executor;
    /** jobId → 已提交的 Runnable（wrapper 在任务执行结束后自清理；QUEUED 取消时用于 remove）。 */
    private final ConcurrentHashMap<String, Runnable> queued = new ConcurrentHashMap<>();

    @Autowired
    public ReplayExportWorkerExecutor(
            @Value("${wotb.replay.artifact.max-concurrent:${wotb.replay.export-job.max-concurrent:1}}")
            final int maxConcurrent,
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

    /**
     * 提交任务（workers + queue 满载抛 {@code RejectedExecutionException} → 503
     * {@code EXPORT_QUEUE_FULL}）。保存可移除句柄供 QUEUED 取消使用。
     */
    public void submit(final String jobId, final Runnable task) {
        final Runnable wrapped = () -> {
            try {
                task.run();
            } finally {
                queued.remove(jobId);
            }
        };
        // 先登记再提交：任务在 execute 前不会被 worker 拾取，避免完成后才 put 造成残留条目。
        queued.put(jobId, wrapped);
        try {
            executor.execute(wrapped);
        } catch (final RejectedExecutionException e) {
            queued.remove(jobId, wrapped);
            throw e;
        }
    }

    /**
     * 把尚未开始执行的 queued 任务从有界队列移除，立即释放 queue slot。
     * 任务已 dequeue / 正在执行时返回 {@code false}（协作取消接管）。
     */
    public boolean removeQueued(final String jobId) {
        final Runnable r = queued.get(jobId);
        if (r == null) {
            return false;
        }
        final boolean removed = executor.remove(r);
        if (removed) {
            queued.remove(jobId);
        }
        return removed;
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

package com.wotb.web.replay.job;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 全局 Replay Full Processing Scheduler（plan §10–§12/§83）：
 * <ul>
 *   <li>全局 CPU 并发固定 {@code max-concurrent}（2C4G 默认 2，禁止超过）——唯一
 *       Replay CPU 预算权威（plan §48/BLOCKER J 最终态）。</li>
 *   <li>job-aware 公平调度：per-job pending deque + 全局 slot + round-robin 派发，
 *       后来的 1-file Job 不会被 50-file Job 全批堵死（plan §6.7/§12）。</li>
 *   <li>queued cancellation：{@link #removeQueued} 立即丢弃尚未开始的 source，
 *       不泄漏 queue 容量；正在执行的 source 由调用方协作取消（plan §53）。</li>
 *   <li>有界排队：{@code queue-capacity} 限制全部 job 的 pending source 总数，
 *       满载 submit 抛 {@link ProcessingQueueFullException}（503 PROCESSING_QUEUE_FULL）。</li>
 *   <li>shutdown 无残留线程（daemon worker + shutdown）。</li>
 * </ul>
 * 本类<b>不承担</b>业务 dedupe / League / Export / AI / DTO 映射（plan §10）。
 */
@Component
public final class ReplayParseScheduler implements AutoCloseable {

    private static final Logger LOGGER = LoggerFactory.getLogger(ReplayParseScheduler.class);

    static final int DEFAULT_MAX_CONCURRENT = 2;
    static final int DEFAULT_QUEUE_CAPACITY = 200;

    /** 单个 source 的 full processing（抛异常由 runner 内自行记 FAILED；此处仅兜底）。 */
    @FunctionalInterface
    public interface SourceRunner {
        void run(int sourceIndex) throws Exception;
    }

    private static final class JobEntry {
        final String jobId;
        final ArrayDeque<Integer> pending = new ArrayDeque<>();
        final SourceRunner runner;
        final Runnable onStart;
        final Runnable onComplete;
        boolean started;
        int activeForJob;

        JobEntry(final String jobId, final List<Integer> sources, final SourceRunner runner,
                 final Runnable onStart, final Runnable onComplete) {
            this.jobId = jobId;
            this.pending.addAll(sources);
            this.runner = runner;
            this.onStart = onStart;
            this.onComplete = onComplete;
        }
    }

    private final int maxConcurrent;
    private final int maxQueuedSources;
    private final ConcurrentHashMap<String, JobEntry> jobs = new ConcurrentHashMap<>();
    /** round-robin 队列：每次派发后把该 job 排到队尾（job-aware fairness）。 */
    private final LinkedBlockingQueue<String> readyJobs = new LinkedBlockingQueue<>();
    private final AtomicInteger activeSources = new AtomicInteger();
    private final AtomicInteger queuedSources = new AtomicInteger();
    private final AtomicInteger activeJobs = new AtomicInteger();
    private final ThreadPoolExecutor workers;

    @Autowired
    public ReplayParseScheduler(
            @Value("${wotb.replay.parse.max-concurrent:2}") final int maxConcurrent,
            @Value("${wotb.replay.parse.queue-capacity:200}") final int maxQueuedSources) {
        if (maxConcurrent < 1) {
            throw new IllegalArgumentException("replay parse max-concurrent must be >= 1: " + maxConcurrent);
        }
        if (maxQueuedSources < 1) {
            throw new IllegalArgumentException("replay parse queue-capacity must be >= 1: " + maxQueuedSources);
        }
        this.maxConcurrent = maxConcurrent;
        this.maxQueuedSources = maxQueuedSources;
        this.workers = new ThreadPoolExecutor(
                maxConcurrent, maxConcurrent, 0L, TimeUnit.MILLISECONDS,
                new java.util.concurrent.LinkedBlockingQueue<>(),
                new NamedDaemonThreadFactory(),
                new ThreadPoolExecutor.AbortPolicy());
    }

    /** 测试便利构造器。 */
    public ReplayParseScheduler(final int maxConcurrent) {
        this(maxConcurrent, DEFAULT_QUEUE_CAPACITY);
    }

    /**
     * 注册一个 job 的全部 source 任务（有界：pending source 总数超限抛
     * {@link ProcessingQueueFullException}）。{@code onStart} 在第一个 source 实际
     * 派发前恰好调用一次（QUEUED → PROCESSING 由调用方状态机处理）；{@code onComplete}
     * 在所有 source 结束（成功/失败/取消跳过）后恰好调用一次。
     */
    public void submit(final String jobId, final List<Integer> sourceIndexes,
                       final SourceRunner runner, final Runnable onStart, final Runnable onComplete) {
        if (sourceIndexes.isEmpty()) {
            onStart.run();
            onComplete.run();
            return;
        }
        // 有界排队：先占 pending 额度，失败不占用。
        while (true) {
            final int cur = queuedSources.get();
            if (cur + sourceIndexes.size() > maxQueuedSources) {
                throw new ProcessingQueueFullException();
            }
            if (queuedSources.compareAndSet(cur, cur + sourceIndexes.size())) {
                break;
            }
        }
        final JobEntry entry = new JobEntry(jobId, sourceIndexes, runner, onStart, onComplete);
        jobs.put(jobId, entry);
        readyJobs.offer(jobId);
        pump();
    }

    /**
     * 取消：丢弃该 job 尚未开始的 source（释放 pending 额度）；已派发/运行中由调用方
     * 协作取消。返回 {@code true} = 没有任何已派发的 source，{@code onComplete} 永不
     * 触发（调用方需自行记录终态）；返回 {@code false} = 有活跃 source，
     * {@code onComplete} 会在最后一个结束后触发。
     */
    public boolean cancelQueued(final String jobId) {
        final JobEntry entry = jobs.get(jobId);
        if (entry == null) {
            return true;
        }
        int drained = 0;
        boolean activeRemaining;
        synchronized (entry) {
            while (!entry.pending.isEmpty()) {
                entry.pending.poll();
                drained++;
            }
            activeRemaining = entry.activeForJob > 0;
        }
        if (drained > 0) {
            queuedSources.addAndGet(-drained);
        }
        if (!activeRemaining) {
            jobs.remove(jobId, entry);
        }
        return !activeRemaining;
    }

    /** 全局调度（每次 slot 释放后触发；round-robin 从队头取 job 派发并排到队尾）。 */
    private void pump() {
        while (activeSources.get() < maxConcurrent) {
            final String jobId = readyJobs.poll();
            if (jobId == null) {
                return;
            }
            final JobEntry entry = jobs.get(jobId);
            if (entry == null) {
                continue;
            }
            final Integer next;
            boolean firstDispatch = false;
            synchronized (entry) {
                next = entry.pending.poll();
                if (next == null) {
                    continue;
                }
                queuedSources.decrementAndGet();
                entry.activeForJob++;
                if (!entry.started) {
                    entry.started = true;
                    firstDispatch = true;
                }
            }
            if (firstDispatch) {
                activeJobs.incrementAndGet();
                try {
                    entry.onStart.run();
                } catch (final RuntimeException e) {
                    LOGGER.warn("replay_parse_job_start_callback_failed jobId={}", jobId, e);
                }
            }
            activeSources.incrementAndGet();
            readyJobs.offer(jobId);
            workers.execute(() -> runSource(entry, next));
        }
    }

    private void runSource(final JobEntry entry, final int sourceIndex) {
        try {
            entry.runner.run(sourceIndex);
        } catch (final Exception e) {
            // runner 负责 per-source FAILED 记账；此处只兜底记录，绝不中断其他 source。
            LOGGER.warn("replay_parse_source_runner_failed jobId={} sourceIndex={}",
                    entry.jobId, sourceIndex, e);
        } finally {
            activeSources.decrementAndGet();
            final boolean jobDone;
            synchronized (entry) {
                entry.activeForJob--;
                jobDone = entry.pending.isEmpty() && entry.activeForJob == 0;
            }
            if (jobDone) {
                activeJobs.decrementAndGet();
                jobs.remove(entry.jobId, entry);
                try {
                    entry.onComplete.run();
                } catch (final RuntimeException e) {
                    LOGGER.error("replay_parse_job_complete_callback_failed jobId={}", entry.jobId, e);
                }
            } else {
                readyJobs.offer(entry.jobId);
            }
            pump();
        }
    }

    // ---- observability（plan §78，低基数） ----

    /** 当前并行执行的 source 数（≤ max-concurrent）。 */
    public int activeSources() {
        return activeSources.get();
    }

    /** 当前排队等待的 source 数（全部 job 的 pending 总和）。 */
    public int queuedSources() {
        return queuedSources.get();
    }

    /** 当前有活跃 source 的 job 数。 */
    public int activeJobs() {
        return activeJobs.get();
    }

    /** 当前在 round-robin 队列中的 job 数。 */
    public int queuedJobs() {
        return readyJobs.size();
    }

    /** 测试可读的 registered job 快照（不暴露内部可变结构）。 */
    List<String> registeredJobs() {
        return new ArrayList<>(jobs.keySet());
    }

    @PreDestroy
    @Override
    public void close() {
        workers.shutdown();
    }

    private static final class NamedDaemonThreadFactory implements ThreadFactory {
        private final AtomicInteger counter = new AtomicInteger();

        @Override
        public Thread newThread(final Runnable runnable) {
            final Thread thread = new Thread(runnable, "wotb-replay-parse-worker-" + counter.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        }
    }
}

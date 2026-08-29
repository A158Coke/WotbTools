package com.wotb.web.replay.job;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 全局 Replay Full Processing Scheduler：
 * <ul>
 *   <li>全局 CPU 并发固定 {@code max-concurrent}（2C4G 默认 2，禁止超过）——唯一
 *       Replay CPU 预算权威。</li>
 *   <li>job-aware 公平调度：per-job pending deque + 全局 slot + round-robin 派发
 *       （每 job 在 ready 队列中至多出现一次，杜绝 dispatch/completion 重复入队），
 *       后来的 1-file Job 不会被 50-file Job 全批堵死。</li>
 *   <li>queued cancellation：{@link #removeQueued} 立即丢弃尚未开始的 source，
 *       不泄漏 queue 容量；正在执行的 source 由调用方协作取消。</li>
 *   <li>有界排队：{@code queue-capacity} 限制全部 job 的 pending source 总数，
 *       满载 submit 抛 {@link ProcessingQueueFullException}（503 PROCESSING_QUEUE_FULL）。</li>
 *   <li>shutdown 无残留线程（daemon worker + shutdown）。</li>
 * </ul>
 *
 * <p><b>线程安全（最终态）</b>：全部调度状态（free-slot reservation、
 * jobs map、per-job pending、ready 成员资格、queuedSources、activeForJob、派发决策、
 * cancellation bookkeeping）统一由 {@link #stateLock} 串行化。业务 runner / onStart /
 * onComplete 一律在锁外执行；worker 线程池内不允许出现 scheduler 不知道的第二层
 * backlog（每次派发前都在锁内预留 slot，{@code reserved+running ≤ maxConcurrent}）。</p>
 * 本类<b>不承担</b>业务 dedupe / League / Export / AI / DTO 映射。
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

    /** {@link #cancelQueued} 的结果语义：明确 completion callback 是否还会触发。 */
    public enum CancellationResult {
        /** 该 job 已从 scheduler 移除，{@code onComplete} 永不触发——调用方必须自行推进终态。 */
        NO_COMPLETION_PENDING,
        /** 仍有活跃 source，{@code onComplete} 会在最后一个结束后触发。 */
        ACTIVE_COMPLETION_PENDING
    }

    private static final class JobEntry {
        final String jobId;
        final ArrayDeque<Integer> pending = new ArrayDeque<>();
        final SourceRunner runner;
        final Runnable onStart;
        final Runnable onComplete;
        boolean started;
        int activeForJob;
        /** 是否已在 {@code readyJobs} 队列中（round-robin 成员资格，至多一次）。 */
        boolean ready;

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
    /** 全部调度状态的单一协调锁（free-slot / jobs / pending / ready / cancellation 统一串行化）。 */
    private final Object stateLock = new Object();
    private final Map<String, JobEntry> jobs = new HashMap<>();
    /** round-robin 队列：每次派发后把该 job 排到队尾（job-aware fairness；成员资格由 entry.ready 保证唯一）。 */
    private final ArrayDeque<String> readyJobs = new ArrayDeque<>();
    /** 已预留/正在执行的 source 数（派发前在锁内 +1，worker 完成在锁内 -1；恒 ≤ maxConcurrent）。 */
    private int activeSources;
    /** 全部 job 尚未派发的 pending source 总数（锁内维护，= queue capacity 的真实 workload）。 */
    private int queuedSources;
    /** 已开始派发且尚未全部完成的 job 数。 */
    private int activeJobs;
    private boolean closed;
    private final ThreadPoolExecutor workers;
    private final MeterRegistry meterRegistry;
    /** 测试专用：completion 记账后、pump 前同步钩子（确定性复现 取消竞态窗口）。 */
    Runnable beforePumpHook;

    @Autowired
    public ReplayParseScheduler(
            @Value("${wotb.replay.parse.max-concurrent:2}") final int maxConcurrent,
            @Value("${wotb.replay.parse.queue-capacity:200}") final int maxQueuedSources,
            @Autowired(required = false) final MeterRegistry meterRegistry) {
        if (maxConcurrent < 1) {
            throw new IllegalArgumentException("replay parse max-concurrent must be >= 1: " + maxConcurrent);
        }
        if (maxQueuedSources < 1) {
            throw new IllegalArgumentException("replay parse queue-capacity must be >= 1: " + maxQueuedSources);
        }
        this.maxConcurrent = maxConcurrent;
        this.maxQueuedSources = maxQueuedSources;
        this.meterRegistry = meterRegistry;
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

    /** 测试便利构造器。 */
    public ReplayParseScheduler(final int maxConcurrent, final int maxQueuedSources) {
        this(maxConcurrent, maxQueuedSources, null);
    }

    /** 低基数 scheduler metrics（无高基数 tag）。 */
    @PostConstruct
    void initMetrics() {
        if (meterRegistry == null) {
            return;
        }
        Gauge.builder("wotb_replay_parse_active", this, ReplayParseScheduler::activeSources)
                .description("当前并行执行的 replay full processing 数")
                .register(meterRegistry);
        Gauge.builder("wotb_replay_parse_queue_depth", this, ReplayParseScheduler::queuedSources)
                .description("排队等待的 replay source 数")
                .register(meterRegistry);
        Gauge.builder("wotb_replay_processing_jobs_active", this, ReplayParseScheduler::activeJobs)
                .description("有活跃 source 的 processing job 数")
                .register(meterRegistry);
        Gauge.builder("wotb_replay_processing_jobs_queued", this, ReplayParseScheduler::queuedJobs)
                .description("round-robin 队列中的 processing job 数")
                .register(meterRegistry);
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
        final JobEntry entry = new JobEntry(jobId, sourceIndexes, runner, onStart, onComplete);
        synchronized (stateLock) {
            if (closed) {
                throw new IllegalStateException("replay parse scheduler is closed");
            }
            // 有界排队：锁内校验 + 占额，失败不占用。
            if (queuedSources + sourceIndexes.size() > maxQueuedSources) {
                throw new ProcessingQueueFullException();
            }
            queuedSources += sourceIndexes.size();
            jobs.put(jobId, entry);
            offerReady(entry);
        }
        pump();
    }

    /**
     * 取消：丢弃该 job 尚未开始的 source（释放 pending 额度）；已派发/运行中由调用方
     * 协作取消。返回 {@link CancellationResult}：
     * {@code NO_COMPLETION_PENDING} = 已从 scheduler 移除（无活跃 source），
     * {@code onComplete} 永不触发，调用方必须自行把 job 推进终态；
     * {@code ACTIVE_COMPLETION_PENDING} = 仍有活跃 source，{@code onComplete}
     * 会在最后一个结束后触发。
     */
    public CancellationResult cancelQueued(final String jobId) {
        synchronized (stateLock) {
            final JobEntry entry = jobs.get(jobId);
            if (entry == null) {
                return CancellationResult.NO_COMPLETION_PENDING;
            }
            int drained = 0;
            while (!entry.pending.isEmpty()) {
                entry.pending.poll();
                drained++;
            }
            queuedSources -= drained;
            final boolean activeRemaining = entry.activeForJob > 0;
            if (!activeRemaining) {
                jobs.remove(jobId, entry);
                readyJobs.remove(jobId);
                entry.ready = false;
                if (entry.started) {
                    // 已派发过（activeJobs 已 +1）但全部 source 已结束/取消 → 释放 job 计数。
                    activeJobs--;
                }
            }
            return activeRemaining ? CancellationResult.ACTIVE_COMPLETION_PENDING
                    : CancellationResult.NO_COMPLETION_PENDING;
        }
    }

    /**
     * 全局调度（每次 slot 释放后触发；round-robin 从队头取 job 派发并排到队尾）。
     * 每次迭代：锁内完成 slot 预留 + ready 成员资格转移 + pending 记账，锁外执行
     * onStart 与 {@code workers.execute}——业务回调绝不在锁内运行。
     */
    private void pump() {
        while (true) {
            final JobEntry entry;
            final Integer next;
            final boolean firstDispatch;
            synchronized (stateLock) {
                if (closed || activeSources >= maxConcurrent) {
                    return;
                }
                entry = pollReady();
                if (entry == null) {
                    return;
                }
                next = entry.pending.poll();
                if (next == null) {
                    continue; // 防御：ready 成员已删除但 pending 已空（取消竞态窗口外不应出现）
                }
                queuedSources--;
                entry.activeForJob++;
                firstDispatch = !entry.started;
                if (firstDispatch) {
                    entry.started = true;
                    activeJobs++;
                }
                // 本 job 本回合只派发一个 source：还有剩余则排到队尾（成员资格唯一，不会重复入队）。
                if (!entry.pending.isEmpty()) {
                    offerReady(entry);
                }
                activeSources++;
            }
            if (firstDispatch) {
                try {
                    entry.onStart.run();
                } catch (final RuntimeException e) {
                    LOGGER.warn("replay_parse_job_start_callback_failed jobId={}", entry.jobId, e);
                }
            }
            try {
                workers.execute(() -> runSource(entry, next));
            } catch (final RejectedExecutionException e) {
                // scheduler 已关闭的窗口竞态：撤销预留，保持计数器不变式，不再派发。
                LOGGER.warn("replay_parse_dispatch_rejected jobId={} sourceIndex={}",
                        entry.jobId, next, e);
                synchronized (stateLock) {
                    activeSources--;
                    entry.activeForJob--;
                    queuedSources++;
                    entry.pending.addFirst(next);
                    if (firstDispatch) {
                        entry.started = false;
                        activeJobs--;
                    }
                    if (!entry.ready) {
                        offerReady(entry);
                    }
                }
                return;
            }
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
            final boolean jobDone;
            synchronized (stateLock) {
                activeSources--;
                entry.activeForJob--;
                jobDone = entry.pending.isEmpty() && entry.activeForJob == 0;
                if (jobDone) {
                    activeJobs--;
                    jobs.remove(entry.jobId, entry);
                    readyJobs.remove(entry.jobId);
                    entry.ready = false;
                } else if (!entry.ready && !entry.pending.isEmpty()) {
                    offerReady(entry);
                }
            }
            if (jobDone) {
                try {
                    entry.onComplete.run();
                } catch (final RuntimeException e) {
                    LOGGER.error("replay_parse_job_complete_callback_failed jobId={}", entry.jobId, e);
                }
            }
            // 测试缝：completion 记账后、pump 派发前（复现取消竞态窗口）。
            if (beforePumpHook != null) {
                beforePumpHook.run();
            }
            // 释放的 slot 在锁外重新派发：与 submit/其他 completion 并发进入 pump() 也安全——
            // 每次派发决策都在 stateLock 内完成 slot 预留，业务回调绝不在锁内运行。
            pump();
        }
    }

    /** ready 队列入队（成员资格由 entry.ready 保证：同一 job 至多出现一次）。 */
    private void offerReady(final JobEntry entry) {
        if (!entry.ready) {
            readyJobs.addLast(entry.jobId);
            entry.ready = true;
        }
    }

    /** ready 队列出队（调用方必须持有 stateLock；返回的 entry.ready 已置 false）。 */
    private JobEntry pollReady() {
        while (!readyJobs.isEmpty()) {
            final String jobId = readyJobs.pollFirst();
            final JobEntry entry = jobs.get(jobId);
            if (entry == null || !entry.ready) {
                continue; // 已取消/已完成的 stale 成员
            }
            entry.ready = false;
            return entry;
        }
        return null;
    }

    // ---- observability（低基数） ----

    /** 当前并行执行的 source 数（≤ max-concurrent）。 */
    public int activeSources() {
        synchronized (stateLock) {
            return activeSources;
        }
    }

    /** 当前排队等待的 source 数（全部 job 的 pending 总和）。 */
    public int queuedSources() {
        synchronized (stateLock) {
            return queuedSources;
        }
    }

    /** 当前有活跃 source 的 job 数。 */
    public int activeJobs() {
        synchronized (stateLock) {
            return activeJobs;
        }
    }

    /** 当前在 round-robin 队列中的 job 数。 */
    public int queuedJobs() {
        synchronized (stateLock) {
            return readyJobs.size();
        }
    }

    /** 测试可读的 registered job 快照（不暴露内部可变结构）。 */
    List<String> registeredJobs() {
        synchronized (stateLock) {
            return new ArrayList<>(jobs.keySet());
        }
    }

    @PreDestroy
    @Override
    public void close() {
        synchronized (stateLock) {
            closed = true;
        }
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

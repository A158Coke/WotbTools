package com.wotb.web.replay.job;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 内存态 Replay Processing Job 注册表 + 临时输入目录生命周期管理（单实例部署）。
 *
 * <p>目录布局：{@code <root>/<jobId>/input/*}（上传持久化输入）。TTL 清理只回收
 * 终态（READY/FAILED/CANCELLED）过期 job；启动时清理孤儿目录；{@code @PreDestroy}
 * 关闭调度器。目录 / TTL / 孤儿清理 / 删除委托共享 {@link ReplayJobStorage}
 * （与 Export 共用同一存储组件）。</p>
 *
 * <p><b>Dataset Lease 生命周期</b>：AI / Playback / Export 消费
 * Processing result 或 derived artifact 前 {@link #acquireForSource(String)} /
 * {@link #acquireForExport(String)} 对 job 的 lease 计数 +1，消费结束后
 * {@link #release(String)} -1；TTL sweeper 只清理 lease 为 0 的过期 job。acquire /
 * release / sweep / remove 全部在同一个 {@code lifecycleLock} 上线性化——成功 acquire
 * 后 sweeper 必然看见 lease 而跳过，sweep/remove 先移除注册后 acquire 必然失败，
 * 绝不存在「acquire 成功但 storage 已删除」的第三种结果。</p>
 */
@Component
public class ReplayProcessingJobStore {

    private static final Logger LOGGER = LoggerFactory.getLogger(ReplayProcessingJobStore.class);

    private final ConcurrentHashMap<String, ReplayProcessingJob> jobs = new ConcurrentHashMap<>();
    /**
     * processingJobId → 活跃 Dataset Lease 数（AI / Playback / Export 共享，
     * acquire/release 配对；语义命名，不再叫 export refs）。
     */
    private final ConcurrentHashMap<String, AtomicInteger> datasetLeaseRefs = new ConcurrentHashMap<>();
    /**
     * Dataset 生命周期原子性边界：acquire（lease+1）、release（lease-1）、
     * sweep/remove（registry 移除 + 建立 no-new-acquire 状态）都在这把锁内线性化；
     * 物理磁盘删除在锁外执行（不长时间占锁），但 acquire 在 registry 移除后无法成功。
     */
    private final Object lifecycleLock = new Object();
    private final ReplayJobStorage storage;
    private final long ttlMinutes;

    @Autowired
    public ReplayProcessingJobStore(
            @Value("${wotb.replay.processing-job.dir:${java.io.tmpdir}/wotb-replay-processing-jobs}") final String dir,
            @Value("${wotb.replay.processing-job.ttl-minutes:30}") final long ttlMinutes) {
        this.storage = new ReplayJobStorage(dir, ttlMinutes, "wotb-replay-processing-job-sweeper");
        this.ttlMinutes = ttlMinutes;
        storage.cleanupOrphans(jobs.keySet());
        storage.startSweeper(this::sweepExpired);
    }

    /** 测试便利构造器（直接给 ttl 分钟数，不读 Spring 配置）。 */
    public ReplayProcessingJobStore(final Path dir, final long ttlMinutes) {
        this.storage = new ReplayJobStorage(dir.toString(), ttlMinutes, "wotb-replay-processing-job-sweeper");
        this.ttlMinutes = ttlMinutes;
        storage.cleanupOrphans(jobs.keySet());
        storage.startSweeper(this::sweepExpired);
    }

    public Path jobDir(final String jobId) {
        return storage.jobDir(jobId);
    }

    public Path inputDir(final String jobId) {
        return storage.inputDir(jobId);
    }

    public void register(final ReplayProcessingJob job) {
        synchronized (lifecycleLock) {
            jobs.put(job.jobId(), job);
        }
    }

    public ReplayProcessingJob get(final String jobId) {
        return jobs.get(jobId);
    }

    /**
     * Export 开始前获取 Processing result 引用（引用计数 +1，阻止 TTL 清理）。
     * job 不存在或未 READY 返回 null（Export 不得读取未完成/不存在的 result）。
     */
    public ReplayProcessingJob acquireForExport(final String jobId) {
        synchronized (lifecycleLock) {
            final ReplayProcessingJob job = jobs.get(jobId);
            if (job == null) {
                return null;
            }
            final ReplayProcessingJob.Snapshot snap = job.snapshot();
            if (snap.status() != ReplayProcessingJob.Status.READY || job.result() == null) {
                return null;
            }
            datasetLeaseRefs.computeIfAbsent(jobId, k -> new AtomicInteger()).incrementAndGet();
            return job;
        }
    }

    /**
     * Dataset Lease：AI / Playback 读取 derived artifact 前获取引用
     * （+1，阻止 TTL 清理）。与 {@link #acquireForExport} 不同，不要求 batch READY——
     * per-source READY 即可（Direct Capability 在 batch finalize 前消费）。
     */
    public ReplayProcessingJob acquireForSource(final String jobId) {
        synchronized (lifecycleLock) {
            final ReplayProcessingJob job = jobs.get(jobId);
            if (job == null) {
                return null;
            }
            datasetLeaseRefs.computeIfAbsent(jobId, k -> new AtomicInteger()).incrementAndGet();
            return job;
        }
    }

    /** Export 终态后释放引用（与 {@link #acquireForExport} 配对）。 */
    public void release(final String jobId) {
        synchronized (lifecycleLock) {
            final AtomicInteger counter = datasetLeaseRefs.get(jobId);
            if (counter != null && counter.decrementAndGet() <= 0) {
                datasetLeaseRefs.remove(jobId, counter);
            }
        }
    }

    /** 移除并物理删除整个 job 目录（输入 + artifact/result；registry 移除在锁内，磁盘删除在锁外）。 */
    public void removeAndCleanup(final String jobId) {
        synchronized (lifecycleLock) {
            jobs.remove(jobId);
            datasetLeaseRefs.remove(jobId);
        }
        storage.removeAndCleanup(jobId);
    }

    /**
     * 周期 TTL 清理（同包测试可直接触发；lease > 0 的 job 跳过）。
     * 锁内完成过期判定 + registry 移除（建立 no-new-acquire 状态），
     * 锁外执行物理磁盘删除——acquire 在 registry 移除后无法成功，物理删除不会
     * 与 acquire 竞争出「acquire 成功但 storage 已删」。
     */
    void sweepExpired() {
        final long cutoff = System.currentTimeMillis() - TimeUnit.MINUTES.toMillis(ttlMinutes);
        final List<String> toClean = new ArrayList<>();
        synchronized (lifecycleLock) {
            for (final ReplayProcessingJob job : jobs.values()) {
                final ReplayProcessingJob.Snapshot snap = job.snapshot();
                final long finishedAt = job.finishedAtMillis();
                final boolean expired = switch (snap.status()) {
                    case READY, FAILED, CANCELLED -> finishedAt > 0 && finishedAt < cutoff;
                    default -> false;
                };
                if (!expired) {
                    continue;
                }
                final AtomicInteger leases = datasetLeaseRefs.get(job.jobId());
                if (leases != null && leases.get() > 0) {
                    // 活跃 Dataset Lease（AI/Playback/Export）正在消费：跳过，等 release 后下轮清理。
                    continue;
                }
                LOGGER.info("replay_processing_job_cleaned ttl_expired=true jobId={} status={}",
                        job.jobId(), snap.status());
                jobs.remove(job.jobId());
                datasetLeaseRefs.remove(job.jobId());
                toClean.add(job.jobId());
            }
        }
        for (final String jobId : toClean) {
            storage.removeAndCleanup(jobId);
        }
    }

    @PreDestroy
    public void close() {
        storage.close();
    }
}

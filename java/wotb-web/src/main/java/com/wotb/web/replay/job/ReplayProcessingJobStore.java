package com.wotb.web.replay.job;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import jakarta.annotation.PreDestroy;
import java.nio.file.Path;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 内存态 Replay Processing Job 注册表 + 临时输入目录生命周期管理（单实例部署）。
 *
 * <p>目录布局：{@code <root>/<jobId>/input/*}（上传持久化输入）。TTL 清理只回收
 * 终态（READY/FAILED/CANCELLED）过期 job；启动时清理孤儿目录；{@code @PreDestroy}
 * 关闭调度器。目录 / TTL / 孤儿清理 / 删除委托共享 {@link ReplayJobStorage}
 * （plan §3，与 Export 共用同一存储组件）。</p>
 *
 * <p><b>Export 引用生命周期（plan §52）</b>：Processing READY 后 Export Job 从本
 * store 读取 {@link ProcessedDataset} 生成 artifact。为避免「Export 进行到一半 →
 * Processing TTL cleanup → result 消失 → FAILED」，Export 创建时
 * {@link #acquire(String)} 对该 job 引用计数 +1，Export 终态后
 * {@link #release(String)} -1；TTL sweeper 只清理引用计数为 0 的过期 job。</p>
 */
@Component
public class ReplayProcessingJobStore {

    private static final Logger LOGGER = LoggerFactory.getLogger(ReplayProcessingJobStore.class);

    private final ConcurrentHashMap<String, ReplayProcessingJob> jobs = new ConcurrentHashMap<>();
    /** processingJobId → 活跃 Export 引用数（acquire/release 配对）。 */
    private final ConcurrentHashMap<String, AtomicInteger> refCounts = new ConcurrentHashMap<>();
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
        jobs.put(job.jobId(), job);
    }

    public ReplayProcessingJob get(final String jobId) {
        return jobs.get(jobId);
    }

    /**
     * Export 开始前获取 Processing result 引用（引用计数 +1，阻止 TTL 清理）。
     * job 不存在或未 READY 返回 null（Export 不得读取未完成/不存在的 result）。
     */
    public ReplayProcessingJob acquireForExport(final String jobId) {
        final ReplayProcessingJob job = jobs.get(jobId);
        if (job == null) {
            return null;
        }
        final ReplayProcessingJob.Snapshot snap = job.snapshot();
        if (snap.status() != ReplayProcessingJob.Status.READY || job.result() == null) {
            return null;
        }
        refCounts.computeIfAbsent(jobId, k -> new AtomicInteger()).incrementAndGet();
        return job;
    }

    /** Export 终态后释放引用（与 {@link #acquireForExport} 配对）。 */
    public void release(final String jobId) {
        final AtomicInteger counter = refCounts.get(jobId);
        if (counter != null && counter.decrementAndGet() <= 0) {
            refCounts.remove(jobId, counter);
        }
    }

    /** 移除并物理删除整个 job 目录（输入）。 */
    public void removeAndCleanup(final String jobId) {
        jobs.remove(jobId);
        refCounts.remove(jobId);
        storage.removeAndCleanup(jobId);
    }

    /** 周期 TTL 清理（同包测试可直接触发；引用计数 > 0 的 job 跳过，plan §52）。 */
    void sweepExpired() {
        final long cutoff = System.currentTimeMillis() - TimeUnit.MINUTES.toMillis(ttlMinutes);
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
            final AtomicInteger refs = refCounts.get(job.jobId());
            if (refs != null && refs.get() > 0) {
                // 活跃 Export 正在消费 result：跳过，等 Export 结束 release 后下轮清理（plan §52）。
                continue;
            }
            LOGGER.info("replay_processing_job_cleaned ttl_expired=true jobId={} status={}", job.jobId(), snap.status());
            removeAndCleanup(job.jobId());
        }
    }

    @PreDestroy
    public void close() {
        storage.close();
    }
}

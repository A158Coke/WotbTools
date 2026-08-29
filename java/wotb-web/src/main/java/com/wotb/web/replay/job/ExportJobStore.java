package com.wotb.web.replay.job;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.file.Path;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * 内存态 Export Job 注册表 + 临时目录生命周期管理（单实例部署）。
 *
 * <p>目录布局：{@code <root>/<jobId>/input/*}（上传持久化输入）与
 * {@code <root>/<jobId>/result.*}（最终 artifact）。TTL 清理只回收终态
 * （READY/FAILED/CANCELLED）过期 job；启动时清理上次进程残留的孤儿目录；
 * {@code @PreDestroy} 关闭调度器（不删数据，留给下次启动清理）。</p>
 *
 * <p>目录 / TTL / 孤儿清理 / 删除逻辑委托共享的 {@link ReplayJobStorage}
 * （plan §3：Export 与 Processing 共用同一存储组件，不复制两套 infrastructure）。</p>
 */
@Component
public class ExportJobStore {

    private static final Logger LOGGER = LoggerFactory.getLogger(ExportJobStore.class);

    private final ConcurrentHashMap<String, ExportJob> jobs = new ConcurrentHashMap<>();
    private final ReplayJobStorage storage;
    private final long ttlMinutes;

    @Autowired
    public ExportJobStore(
            @Value("${wotb.replay.export-job.dir:${java.io.tmpdir}/wotb-export-jobs}") final String dir,
            @Value("${wotb.replay.export-job.ttl-minutes:30}") final long ttlMinutes) {
        this.storage = new ReplayJobStorage(dir, ttlMinutes, "wotb-export-job-sweeper");
        this.ttlMinutes = ttlMinutes;
        storage.cleanupOrphans(jobs.keySet());
        storage.startSweeper(this::sweepExpired);
    }

    /** 测试便利构造器（直接给 ttl 分钟数，不读 Spring 配置）。 */
    public ExportJobStore(final Path dir, final long ttlMinutes) {
        this.storage = new ReplayJobStorage(dir.toString(), ttlMinutes, "wotb-export-job-sweeper");
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

    public void register(final ExportJob job) {
        jobs.put(job.jobId(), job);
    }

    public ExportJob get(final String jobId) {
        return jobs.get(jobId);
    }

    /** 移除并物理删除整个 job 目录（输入 + artifact）。 */
    public void removeAndCleanup(final String jobId) {
        jobs.remove(jobId);
        storage.removeAndCleanup(jobId);
    }

    private void sweepExpired() {
        final long cutoff = System.currentTimeMillis() - TimeUnit.MINUTES.toMillis(ttlMinutes);
        for (final ExportJob job : jobs.values()) {
            final ExportJob.Snapshot snap = job.snapshot();
            final long finishedAt = job.finishedAtMillis();
            final boolean expired = switch (snap.status()) {
                case READY, FAILED, CANCELLED -> finishedAt > 0 && finishedAt < cutoff;
                default -> false;
            };
            if (expired) {
                LOGGER.info("export_job_cleaned ttl_expired=true jobId={} status={}", job.jobId(), snap.status());
                removeAndCleanup(job.jobId());
            }
        }
    }

    @PreDestroy
    public void close() {
        storage.close();
    }
}

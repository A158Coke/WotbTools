package com.wotb.web.replay.job;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

/**
 * 内存态 Export Job 注册表 + 临时目录生命周期管理（单实例部署）。
 *
 * <p>目录布局：{@code <root>/<jobId>/input/*}（上传持久化输入）与
 * {@code <root>/<jobId>/result.*}（最终 artifact）。TTL 清理只回收终态
 * （READY/FAILED/CANCELLED）过期 job；启动时清理上次进程残留的孤儿目录；
 * {@code @PreDestroy} 关闭调度器（不删数据，留给下次启动清理）。</p>
 */
@Component
public class ExportJobStore {

    private static final Logger LOGGER = LoggerFactory.getLogger(ExportJobStore.class);

    private final ConcurrentHashMap<String, ExportJob> jobs = new ConcurrentHashMap<>();
    private final Path rootDir;
    private final long ttlMillis;
    private final ScheduledExecutorService sweeper;

    public ExportJobStore(
            @Value("${wotb.replay.export-job.dir:${java.io.tmpdir}/wotb-export-jobs}") final String dir,
            @Value("${wotb.replay.export-job.ttl-minutes:30}") final long ttlMinutes) {
        this.rootDir = Path.of(dir);
        this.ttlMillis = TimeUnit.MINUTES.toMillis(Math.max(1L, ttlMinutes));
        try {
            Files.createDirectories(rootDir);
            cleanupOrphans();
        } catch (final IOException e) {
            throw new UncheckedIOException("Cannot create export job dir " + rootDir, e);
        }
        this.sweeper = Executors.newSingleThreadScheduledExecutor(r -> {
            final Thread t = new Thread(r, "wotb-export-job-sweeper");
            t.setDaemon(true);
            return t;
        });
        sweeper.scheduleWithFixedDelay(this::sweepExpired, 5, 5, TimeUnit.MINUTES);
    }

    public Path jobDir(final String jobId) {
        return rootDir.resolve(jobId);
    }

    public Path inputDir(final String jobId) {
        return jobDir(jobId).resolve("input");
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
        deleteDir(jobDir(jobId));
    }

    /** 启动清理：删除 rootDir 下所有非活跃 job 目录（上次进程崩溃残留）。 */
    private void cleanupOrphans() throws IOException {
        try (Stream<Path> dirs = Files.list(rootDir)) {
            dirs.filter(Files::isDirectory)
                    .forEach(dir -> {
                        final String jobId = dir.getFileName().toString();
                        if (jobs.containsKey(jobId)) {
                            return;
                        }
                        LOGGER.info("export_job_cleaned startup_orphan=true jobId={}", jobId);
                        deleteDir(dir);
                    });
        }
    }

    private void sweepExpired() {
        final long cutoff = System.currentTimeMillis() - ttlMillis;
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

    private static void deleteDir(final Path dir) {
        if (!Files.exists(dir)) {
            return;
        }
        try (Stream<Path> walk = Files.walk(dir)) {
            walk.sorted(Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.deleteIfExists(p);
                } catch (final IOException e) {
                    LOGGER.warn("export_job_cleanup_failed path={} error={}", p, e.getMessage());
                }
            });
        } catch (final IOException e) {
            LOGGER.warn("export_job_cleanup_walk_failed path={} error={}", dir, e.getMessage());
        }
    }

    @PreDestroy
    public void close() {
        sweeper.shutdownNow();
    }
}

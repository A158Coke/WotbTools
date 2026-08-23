package com.wotb.web.replay.job;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

/**
 * Replay Job 通用临时目录生命周期管理（Export Job 与 Replay Processing Job 共用，
 * composition；plan §3 避免两套相同 infrastructure）。
 *
 * <p>职责：job 目录布局（{@code <root>/<jobId>/input/*} + 各 job 自己的 artifact /
 * result 文件）、启动孤儿目录清理（上次进程崩溃残留）、周期 TTL sweeper（终态过期
 * job 由注册表 {@code removeAndCleanup} 删除）、{@code @PreDestroy} 关闭调度器
 * （不删数据，留给下次启动清理）。注册表（{@code ConcurrentHashMap}）由调用方 store
 * 持有，本类不感知 job 类型。</p>
 *
 * <p>每个 store 实例使用独立 root（如 {@code wotb-export-jobs} 与
 * {@code wotb-replay-processing-jobs}），孤儿清理互不误删。</p>
 */
public final class ReplayJobStorage {

    private static final Logger LOGGER = LoggerFactory.getLogger(ReplayJobStorage.class);

    private final Path rootDir;
    private final long ttlMillis;
    private final ScheduledExecutorService sweeper;

    /**
     * @param dir              job 根目录（{@code <root>/<jobId>/...}）
     * @param ttlMinutes       终态 job 保留时长（至少 1 分钟）
     * @param sweeperThreadName sweeper 线程名（区分多个 store）
     */
    public ReplayJobStorage(final String dir, final long ttlMinutes, final String sweeperThreadName) {
        this.rootDir = Path.of(dir);
        this.ttlMillis = TimeUnit.MINUTES.toMillis(Math.max(1L, ttlMinutes));
        try {
            Files.createDirectories(rootDir);
        } catch (final IOException e) {
            throw new UncheckedIOException("Cannot create replay job dir " + rootDir, e);
        }
        this.sweeper = Executors.newSingleThreadScheduledExecutor(r -> {
            final Thread t = new Thread(r, sweeperThreadName);
            t.setDaemon(true);
            return t;
        });
    }

    public Path jobDir(final String jobId) {
        return rootDir.resolve(jobId);
    }

    public Path inputDir(final String jobId) {
        return jobDir(jobId).resolve("input");
    }

    /**
     * 启动周期 TTL 清理（5 分钟间隔）。{@code sweep} 由注册表 store 实现：遍历其
     * jobs 映射，对终态且过期（finishedAt < now - ttl）的 job 调用
     * {@link #removeAndCleanup(String)}。
     */
    public void startSweeper(final Runnable sweep) {
        sweeper.scheduleWithFixedDelay(sweep, 5, 5, TimeUnit.MINUTES);
    }

    /** 启动清理：删除 rootDir 下所有不在 {@code activeJobIds} 中的 job 目录（上次进程崩溃残留）。 */
    public void cleanupOrphans(final Set<String> activeJobIds) {
        try (Stream<Path> dirs = Files.list(rootDir)) {
            dirs.filter(Files::isDirectory)
                    .forEach(dir -> {
                        final String jobId = dir.getFileName().toString();
                        if (activeJobIds.contains(jobId)) {
                            return;
                        }
                        LOGGER.info("replay_job_cleaned startup_orphan=true jobId={}", jobId);
                        deleteDir(dir);
                    });
        } catch (final IOException e) {
            LOGGER.warn("replay_job_orphan_walk_failed path={} error={}", rootDir, e.getMessage());
        }
    }

    /** 移除并物理删除整个 job 目录（输入 + artifact/result）。 */
    public void removeAndCleanup(final String jobId) {
        deleteDir(jobDir(jobId));
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
                    LOGGER.warn("replay_job_cleanup_failed path={} error={}", p, e.getMessage());
                }
            });
        } catch (final IOException e) {
            LOGGER.warn("replay_job_cleanup_walk_failed path={} error={}", dir, e.getMessage());
        }
    }

    /** 关闭调度器（不删数据，留给下次启动清理）。 */
    public void close() {
        sweeper.shutdownNow();
    }
}

package com.wotb.web.replay.job;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * {@code local} 模式的 {@link ReplayProcessingResultReader}：dataset 来自进程内存，derived artifact
 * 来自 job 目录。
 *
 * <p>只在 {@code local} 执行模式下存在（distributed 的实现是
 * {@link ObjectStorageReplayDatasetRepository}），两者不会同时装配。</p>
 *
 * <p><b>为什么本地也要有这一层</b>：消费者（GET result / AI Review / Map Overview / Playback V2）
 * 因此只有一条读取路径，不需要在 feature 里判断执行模式——「distributed 下 TX 本地磁盘不参与读取」
 * 就成了结构事实而不是纪律。本实现逐字保留引入前的行为：内存 {@code job.result()}、job 目录里的
 * artifact 文件（缺失即 {@code null}）。</p>
 */
@Component
@ConditionalOnProperty(name = ReplayExecutionMode.PROPERTY,
        havingValue = ReplayExecutionMode.LOCAL_VALUE, matchIfMissing = true)
public final class LocalReplayDatasetRepository implements ReplayProcessingResultReader {

    private final ReplayProcessingJobStore store;

    public LocalReplayDatasetRepository(final ReplayProcessingJobStore store) {
        this.store = store;
    }

    @Override
    public ProcessedDataset readReadyDataset(final ReplayProcessingJob job) {
        return job.result();
    }

    @Override
    public byte[] aiFacts(final String jobId, final int sourceIndex) throws IOException {
        return readArtifact(jobId, ReplayArtifactWriter.aiFactsPath(store.jobDir(jobId), sourceIndex));
    }

    @Override
    public byte[] mapOverview(final String jobId, final int sourceIndex) throws IOException {
        return readArtifact(jobId, ReplayArtifactWriter.mapOverviewPath(store.jobDir(jobId), sourceIndex));
    }

    @Override
    public byte[] battlePlaybackV2(final String jobId, final int sourceIndex) throws IOException {
        return readArtifact(jobId, ReplayArtifactWriter.battlePlaybackV2Path(store.jobDir(jobId), sourceIndex));
    }

    /** {@code null} = 文件不存在（capability unavailable），其它 I/O 故障原样上抛。 */
    private static byte[] readArtifact(final String jobId, final Path path) throws IOException {
        if (!Files.exists(path)) {
            return null;
        }
        return Files.readAllBytes(path);
    }
}

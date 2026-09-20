package com.wotb.web.replay.job;

import com.wotb.contracts.ObjectKey;
import com.wotb.contracts.ObjectStorage;
import com.wotb.core.model.Battle;
import com.wotb.core.parse.Replays;
import com.wotb.storage.ObjectStorageKeys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * 分布式模式下 {@code result/} 对象布局的唯一 owner，同时是两个端口的实现：
 *
 * <ul>
 *   <li>{@link ReplayProcessingResultReader}：READY 之后的 dataset 读取（{@code finalized.json}）；</li>
 *   <li>{@link ReplayBatchFinalization}：FINAIZING_BATCH 收尾（读 per-source → 批次收尾 → 写
 *       {@code finalized.json}）。</li>
 * </ul>
 *
 * <p><b>对象布局</b>（键一律由 {@link ObjectStorageKeys} 组装）：</p>
 * <ul>
 *   <li>{@code result/source-<i>.json} —— parser-worker 写的 canonical per-source dataset，
 *       是**收尾的输入**；</li>
 *   <li>{@code result/finalized.json} —— 控制面 FINALIZING_BATCH 写的 finalized batch dataset，
 *       是**读取侧唯一的数据集**。</li>
 * </ul>
 *
 * <p><b>为什么不能再在读取侧拼 per-source</b>：把 per-source battle 直接拼起来会跳过
 * dedupe / 冲突判定 / League Rating / 批次聚合 / enrichment，等于在读取路径里发明第二套批次语义
 * （也会让 {@code GET result} 与 Export 看到不同的数字）。收尾只在 FINALIZING_BATCH 发生一次，
 * 读取侧永远只读它的产物。</p>
 *
 * <p><b>读不到就是「暂不可用」</b>：{@code finalized.json} 缺失/损坏/version 不匹配一律返回
 * {@code null}（调用方按既有契约 409 JOB_NOT_READY），绝不返回半个 batch、也不回退到 per-source
 * 拼接。相反，收尾阶段缺 per-source 输入是**不可恢复的数据缺失**——抛 {@link IOException} 让投递
 * 进 DLQ 等 operator 判断，而不是把凭空少一场的批次算成成功。</p>
 */
public final class ObjectStorageReplayDatasetRepository
        implements ReplayProcessingResultReader, ReplayBatchFinalization {

    private static final Logger LOGGER = LoggerFactory.getLogger(ObjectStorageReplayDatasetRepository.class);

    /** canonical per-source dataset 的对象前缀；完整键由 {@link ObjectStorageKeys} 组装。 */
    private static final String SOURCE_DATASET_PREFIX = "result/source-";

    /** finalized batch dataset 的对象路径。 */
    private static final String FINALIZED_DATASET_PATH = "result/finalized.json";

    private static final String CONTENT_TYPE_JSON = "application/json";

    private static final ObjectMapper MAPPER = JsonMapper.builder().build();

    private final ObjectStorage storage;

    public ObjectStorageReplayDatasetRepository(final ObjectStorage storage) {
        this.storage = Objects.requireNonNull(storage, "storage");
    }

    // ---- 读取侧：READY 之后只读 finalized batch dataset ----

    @Override
    public ProcessedDataset readReadyDataset(final ReplayProcessingJob job) {
        final ObjectKey key = ObjectStorageKeys.tempJobObject(job.jobId(), FINALIZED_DATASET_PATH);
        try {
            if (!storage.exists(key)) {
                LOGGER.error("event=replay_processing_dataset_absent jobId={} key={}", job.jobId(), key.value());
                return null;
            }
            final FinalizedDataset dataset = MAPPER.readValue(readAll(key), FinalizedDataset.class);
            if (!FinalizedDataset.SCHEMA_VERSION.equals(dataset.schemaVersion())) {
                LOGGER.error("event=replay_processing_dataset_version_mismatch jobId={} got={}",
                        job.jobId(), dataset.schemaVersion());
                return null;
            }
            LOGGER.info("event=replay_processing_dataset_read jobId={} battles={}",
                    job.jobId(), dataset.battles().size());
            return dataset.toProcessedDataset();
        } catch (final IOException | JacksonException | IllegalArgumentException e) {
            LOGGER.error("event=replay_processing_dataset_unreadable jobId={} key={}", job.jobId(), key.value(), e);
            return null;
        }
    }

    // ---- 收尾侧：per-source canonical dataset → FINALIZING_BATCH → finalized batch dataset ----

    @Override
    public ProcessedDataset finalizeBatch(final ReplayProcessingJob job) throws IOException {
        final ProcessedDataset dataset =
                ReplayBatchFinalizer.finalizeBatch(perSourceEntries(job), null, null);
        writeFinalized(job.jobId(), dataset);
        LOGGER.info("event=replay_processing_dataset_finalized jobId={} battles={} duplicates={} failures={}",
                job.jobId(), dataset.battles().size(), dataset.duplicates().size(), dataset.failures().size());
        return dataset;
    }

    /**
     * 用「PG 里的 source 终态 + 对象存储里的 per-source canonical Battle」构造 finalize 输入。
     *
     * <p>{@link Replays.ParsedEntry} 只携带 {@code (sourceIndex, sourceName, Battle, failureMessage)}，
     * 因此分布式控制面能构造出与本地进程内**完全相同**的输入——解析中间态不需要跨进程搬运。</p>
     */
    private List<Replays.ParsedEntry> perSourceEntries(final ReplayProcessingJob job) throws IOException {
        final List<Replays.ParsedEntry> entries = new ArrayList<>();
        for (final ReplayProcessingJob.SourceState source : job.sourceStates()) {
            if (source.status() == ReplayProcessingJob.SourceStatus.FAILED) {
                entries.add(new Replays.ParsedEntry(source.sourceIndex(), source.sourceName(), null,
                        source.failureMessage() == null ? "REPLAY_PROCESSING_FAILED" : source.failureMessage()));
                continue;
            }
            final RemoteSourceDataset dataset = readSourceDataset(job.jobId(), source.sourceIndex());
            if (dataset == null || dataset.battles().isEmpty()) {
                // READY 的 source 却没有 canonical battle = 数据缺失，不是「0 场有效回放」：
                // 把缺失静默当成空批次会产出错误的 batch 数字，因此 fail closed 交给 operator。
                throw new IOException("per-source canonical dataset missing for job " + job.jobId()
                        + " source " + source.sourceIndex());
            }
            for (final Battle battle : dataset.battles()) {
                entries.add(new Replays.ParsedEntry(source.sourceIndex(), source.sourceName(), battle, null));
            }
        }
        return entries;
    }

    private void writeFinalized(final String jobId, final ProcessedDataset dataset) throws IOException {
        final ObjectKey key = ObjectStorageKeys.tempJobObject(jobId, FINALIZED_DATASET_PATH);
        final byte[] body = MAPPER.writeValueAsBytes(FinalizedDataset.from(dataset));
        storage.put(key, new ByteArrayInputStream(body), body.length, CONTENT_TYPE_JSON);
    }

    /** @return 反序列化后的 per-source dataset；对象缺失/损坏/version 不匹配一律 {@code null} */
    private RemoteSourceDataset readSourceDataset(final String jobId, final int sourceIndex) {
        final ObjectKey key = ObjectStorageKeys.tempJobObject(jobId, SOURCE_DATASET_PREFIX + sourceIndex + ".json");
        try {
            if (!storage.exists(key)) {
                LOGGER.error("event=replay_processing_source_dataset_absent jobId={} sourceIndex={} key={}",
                        jobId, sourceIndex, key.value());
                return null;
            }
            final RemoteSourceDataset dataset = MAPPER.readValue(readAll(key), RemoteSourceDataset.class);
            if (!RemoteSourceDataset.SCHEMA_VERSION.equals(dataset.schemaVersion())) {
                LOGGER.error("event=replay_processing_source_dataset_version_mismatch jobId={} sourceIndex={} got={}",
                        jobId, sourceIndex, dataset.schemaVersion());
                return null;
            }
            return dataset;
        } catch (final IOException | JacksonException | IllegalArgumentException e) {
            LOGGER.error("event=replay_processing_source_dataset_unreadable jobId={} sourceIndex={} key={}",
                    jobId, sourceIndex, key.value(), e);
            return null;
        }
    }

    private byte[] readAll(final ObjectKey key) throws IOException {
        try (InputStream content = storage.get(key)) {
            return content.readAllBytes();
        }
    }
}

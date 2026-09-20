package com.wotb.web.replay.job;

import com.wotb.contracts.ObjectKey;
import com.wotb.contracts.ObjectStorage;
import com.wotb.core.model.Battle;
import com.wotb.storage.ObjectStorageKeys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * 分布式模式的 {@link ReplayProcessingResultReader}：READY dataset 从对象存储的
 * {@code temp/jobs/<jobId>/result/source-<i>.json} 读回。
 *
 * <p>本进程在分布式模式下不保存 {@link ProcessedDataset}（解析发生在 parser-worker），
 * 因此「READY」的权威事实来自 PostgreSQL 状态机，而 dataset 内容来自对象存储：这正是
 * 「job 状态与 dataset 分离」的落点。</p>
 *
 * <p><b>读不到就是「暂不可用」</b>：任一 READY source 缺少 canonical dataset（对象被生命周期
 * 回收、worker 尚未写完、对象损坏）时返回 {@code null}，调用方按既有契约返回
 * {@code 409 JOB_NOT_READY}——不发明新的错误码，也绝不返回半个 batch。</p>
 */
public final class ObjectStorageReplayProcessingResultReader implements ReplayProcessingResultReader {

    private static final Logger LOGGER = LoggerFactory.getLogger(ObjectStorageReplayProcessingResultReader.class);

    /** canonical per-source dataset 的对象前缀；完整键由 {@link ObjectStorageKeys} 组装。 */
    private static final String RESULT_PREFIX = "result/source-";

    private static final ObjectMapper MAPPER = JsonMapper.builder().build();

    private final ObjectStorage storage;

    public ObjectStorageReplayProcessingResultReader(final ObjectStorage storage) {
        this.storage = Objects.requireNonNull(storage, "storage");
    }

    @Override
    public ProcessedDataset readReadyDataset(final ReplayProcessingJob job) {
        final List<Battle> battles = new ArrayList<>();
        final List<String> battleSourceNames = new ArrayList<>();
        final List<String> battleSourceIds = new ArrayList<>();
        final List<String[]> duplicates = new ArrayList<>();
        final List<String[]> failures = new ArrayList<>();
        for (final ReplayProcessingJob.SourceState source : job.sourceStates()) {
            if (source.status() != ReplayProcessingJob.SourceStatus.READY) {
                continue;
            }
            final RemoteSourceDataset dataset = read(job.jobId(), source.sourceIndex());
            if (dataset == null) {
                return null;
            }
            merge(dataset, source, battles, battleSourceNames, battleSourceIds, duplicates, failures);
        }
        if (battles.isEmpty()) {
            LOGGER.error("event=replay_processing_dataset_missing jobId={} status=READY total={}",
                    job.jobId(), job.total());
            return null;
        }
        LOGGER.info("event=replay_processing_dataset_read jobId={} battles={}", job.jobId(), battles.size());
        return new ProcessedDataset(battles, battleSourceNames, battleSourceIds, duplicates, failures, null, null);
    }

    /**
     * 把一条 source 的 canonical dataset 拼进 batch：battle 与 source identity 必须逐位对齐
     * （worker 只写 1 场，防御性地对缺失的 name/id 回落到 source 自身的权威 identity）。
     */
    private static void merge(final RemoteSourceDataset dataset,
                              final ReplayProcessingJob.SourceState source,
                              final List<Battle> battles,
                              final List<String> battleSourceNames,
                              final List<String> battleSourceIds,
                              final List<String[]> duplicates,
                              final List<String[]> failures) {
        for (int i = 0; i < dataset.battles().size(); i++) {
            battles.add(dataset.battles().get(i));
            battleSourceNames.add(i < dataset.battleSourceNames().size()
                    ? dataset.battleSourceNames().get(i) : source.sourceName());
            battleSourceIds.add(i < dataset.battleSourceIds().size()
                    ? dataset.battleSourceIds().get(i) : source.sourceId());
        }
        duplicates.addAll(dataset.duplicates());
        failures.addAll(dataset.failures());
    }

    /** @return 反序列化后的 dataset；对象缺失/损坏/version 不匹配一律 {@code null}（fail closed） */
    private RemoteSourceDataset read(final String jobId, final int sourceIndex) {
        final ObjectKey key = ObjectStorageKeys.tempJobObject(jobId, RESULT_PREFIX + sourceIndex + ".json");
        try {
            if (!storage.exists(key)) {
                LOGGER.error("event=replay_processing_dataset_absent jobId={} sourceIndex={} key={}",
                        jobId, sourceIndex, key.value());
                return null;
            }
            final byte[] body;
            try (InputStream content = storage.get(key)) {
                body = content.readAllBytes();
            }
            final RemoteSourceDataset dataset = MAPPER.readValue(body, RemoteSourceDataset.class);
            if (!RemoteSourceDataset.SCHEMA_VERSION.equals(dataset.schemaVersion())) {
                LOGGER.error("event=replay_processing_dataset_version_mismatch jobId={} sourceIndex={} got={}",
                        jobId, sourceIndex, dataset.schemaVersion());
                return null;
            }
            return dataset;
        } catch (final IOException | JacksonException | IllegalArgumentException e) {
            LOGGER.error("event=replay_processing_dataset_unreadable jobId={} sourceIndex={} key={}",
                    jobId, sourceIndex, key.value(), e);
            return null;
        }
    }
}

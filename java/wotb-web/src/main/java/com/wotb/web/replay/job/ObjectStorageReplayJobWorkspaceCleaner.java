package com.wotb.web.replay.job;

import com.wotb.contracts.ObjectKey;
import com.wotb.contracts.ObjectStorage;
import com.wotb.storage.ObjectStorageKeys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.Objects;

/**
 * {@link ReplayJobWorkspaceCleaner} 的对象存储实现：删除
 * {@code temp/jobs/<jobId>/{input,result,artifacts}/…} 下的**确定键集合**。
 *
 * <p>键的推导与写入方逐字对应（全部经 {@link ObjectStorageKeys}，因此 jobId / sourceName 仍然受
 * 「单段、无 {@code ..}、无绝对路径、无反斜杠、无控制字符」的既有校验约束）：</p>
 *
 * <ul>
 *   <li>{@code input/<i>/<sourceName>} —— 控制面 create 时写的原始回放；</li>
 *   <li>{@code result/source-<i>.json} —— worker 写的 canonical per-source dataset；</li>
 *   <li>{@code result/finalized.json} —— 控制面 FINALIZING_BATCH 写的 batch dataset；</li>
 *   <li>{@code artifacts/<i>/{ai-facts,map-overview,battle-playback-v2}.json} —— worker 写的 artifact。</li>
 * </ul>
 *
 * <p>这就是这个 job 在对象存储里的全部内容（{@code tempJobObject} 的全部调用点都落在这些形状上）。
 * 刻意不引入 {@code list}：按 job 身份枚举确定键既不会碰到别的 job，也不需要给应用层任何
 * 「删任意前缀」的能力；万一未来新增了未在此枚举的对象类型，1 天 lifecycle 仍是兜底。</p>
 */
public final class ObjectStorageReplayJobWorkspaceCleaner implements ReplayJobWorkspaceCleaner {

    private static final Logger LOGGER = LoggerFactory.getLogger(ObjectStorageReplayJobWorkspaceCleaner.class);

    private static final String RESULT_FINALIZED = "result/finalized.json";
    private static final String SOURCE_DATASET_PREFIX = "result/source-";
    private static final String INPUT_PREFIX = "input/";
    private static final String ARTIFACT_PREFIX = "artifacts/";

    private final ObjectStorage storage;

    public ObjectStorageReplayJobWorkspaceCleaner(final ObjectStorage storage) {
        this.storage = Objects.requireNonNull(storage, "storage");
    }

    @Override
    public void deleteJobWorkspace(final ReplayProcessingJob job) throws IOException {
        final String jobId = job.jobId();
        storage.delete(key(jobId, RESULT_FINALIZED));
        for (final ReplayProcessingJob.SourceState source : job.sourceStates()) {
            final int index = source.sourceIndex();
            storage.delete(key(jobId, SOURCE_DATASET_PREFIX + index + ".json"));
            storage.delete(key(jobId, ARTIFACT_PREFIX + index + "/" + ReplayArtifactWriter.AI_FACTS_NAME));
            storage.delete(key(jobId, ARTIFACT_PREFIX + index + "/" + ReplayArtifactWriter.MAP_OVERVIEW_NAME));
            storage.delete(key(jobId, ARTIFACT_PREFIX + index + "/"
                    + ReplayArtifactWriter.BATTLE_PLAYBACK_V2_NAME));
            storage.delete(key(jobId, INPUT_PREFIX + index + "/" + source.sourceName()));
        }
        LOGGER.info("event=replay_job_workspace_deleted jobId={} sources={}",
                jobId, job.sourceStates().size());
    }

    private static ObjectKey key(final String jobId, final String relativePath) {
        return ObjectStorageKeys.tempJobObject(jobId, relativePath);
    }
}

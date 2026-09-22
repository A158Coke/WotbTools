package com.wotb.web.replay.job;

import com.wotb.core.model.Battle;
import com.wotb.core.parse.Replays;
import com.wotb.core.replay.processing.ReplayProcessingLifecycle;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.processing.ReplayProcessingSourceOutcome;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelinePerspective;
import com.wotb.web.replay.ai.BattlePlaybackProjector;
import com.wotb.web.replay.ai.MapOverviewBuilder;
import com.wotb.web.replay.dto.BattlePlaybackDataset;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.util.Objects;
import java.util.function.Supplier;

/**
 * 单个 value-addressed 源的执行体：canonical 解析结果 + 派生 artifact 生成 + sink 落地 + lifecycle 回报。
 *
 * <p><b>存储无关</b>：本类不认识 {@code Path}、{@code ObjectStorage} 或任何具体后端——canonical 解析
 * 由调用方通过 {@code processing} supplier 提供（执行侧自行挂 Micrometer 计时），artifact 通过
 * {@link ReplayArtifactSink} 落地。唯一生产调用方是 parser worker（MinIO sink），因此不存在第二个
 * parser、也不存在第二套 artifact 生成逻辑。</p>
 *
 * <p>并发预算不在本类：由 AMQP {@code prefetch} 表达。</p>
 */
public final class ReplayProcessingSourceRunner {

    private static final Logger LOGGER = LoggerFactory.getLogger(ReplayProcessingSourceRunner.class);

    private final ReplayArtifactSink artifactSink;
    private final ReplayProcessingLifecycle lifecycle;

    public ReplayProcessingSourceRunner(final ReplayArtifactSink artifactSink,
                                        final ReplayProcessingLifecycle lifecycle) {
        this.artifactSink = Objects.requireNonNull(artifactSink, "artifactSink");
        this.lifecycle = Objects.requireNonNull(lifecycle, "lifecycle");
    }

    /**
     * 处理一个源并回报 {@link ReplayProcessingLifecycle}。
     *
     * <p>错误分类保持稳定：artifact 落地失败（{@link IOException}）→
     * {@code PROCESSING_JOB_STORAGE_UNAVAILABLE}；其它失败 → {@link ReplayProcessingSourceException}
     * 的 error code 或 {@code REPLAY_PROCESSING_FAILED}，失败信息为 {@code code} 或
     * {@code code: message}。</p>
     */
    public ReplayProcessingSourceOutcome processSource(final String jobId,
                                                       final int sourceIndex,
                                                       final String sourceName,
                                                       final Supplier<ReplayProcessingResult> processing) {
        lifecycle.sourceStarted(jobId, sourceIndex, sourceName);
        Replays.ParsedEntry entry;
        boolean success = false;
        try {
            final ReplayProcessingResult result = processing.get();
            writeArtifacts(jobId, sourceIndex, sourceName, result);
            entry = new Replays.ParsedEntry(sourceIndex, sourceName, result.battle(), null);
            success = true;
        } catch (final Exception e) {
            entry = new Replays.ParsedEntry(sourceIndex, sourceName, null,
                    failureMessage(jobId, sourceIndex, sourceName, e));
        }
        final ReplayProcessingSourceOutcome outcome =
                new ReplayProcessingSourceOutcome(jobId, sourceIndex, sourceName, entry, success);
        lifecycle.sourceCompleted(outcome);
        return outcome;
    }

    /**
     * canonical 解析结果校验：{@code battle == null} 时按既有语义抛
     * {@link ReplayProcessingSourceException}（稳定 error code 来自结果本身）。
     *
     * <p>parser worker 通过它把 {@code ReplayProcessingResult} 归一为
     * "要么有多少 battle，要么有多少 error code"。</p>
     */
    public static ReplayProcessingResult requireBattle(final ReplayProcessingResult result) {
        if (result.battle() == null) {
            final String code = result.error() != null && StringUtils.hasText(result.error().code())
                    ? result.error().code() : "REPLAY_PROCESSING_FAILED";
            final String message = result.error() != null && StringUtils.hasText(result.error().message())
                    ? result.error().message() : "REPLAY_PROCESSING_FAILED";
            throw new ReplayProcessingSourceException(code, message);
        }
        return result;
    }

    /** 把既有派生 artifact 生成结果写入 sink（含 V2 可用性诊断日志）。 */
    public void writeArtifacts(final String jobId, final int sourceIndex, final String sourceName,
                               final ReplayProcessingResult result) throws Exception {
        final Battle battle = result.battle();
        final byte[] mapOverview = ReplayArtifactWriter.mapOverviewContent(
                MapOverviewBuilder.build(battle, result.reconstruction()));
        if (mapOverview != null) {
            artifactSink.write(sourceIndex, ReplayArtifactWriter.MAP_OVERVIEW_NAME, mapOverview);
        }
        final V2BuildOutcome v2 = buildBattlePlaybackV2(battle, result);
        if (v2.dataset() != null) {
            artifactSink.write(sourceIndex, ReplayArtifactWriter.BATTLE_PLAYBACK_V2_NAME,
                    ReplayArtifactWriter.battlePlaybackV2Content(v2.dataset()));
            LOGGER.info("event=processing_job_v2_available jobId={} sourceIndex={} sourceName={}",
                    jobId, sourceIndex, sourceName);
        } else if (v2.failure() != null) {
            LOGGER.error("event=processing_job_v2_error jobId={} sourceIndex={} sourceName={} reason={}",
                    jobId, sourceIndex, sourceName, v2.reason(), v2.failure());
        } else {
            LOGGER.info("event=processing_job_v2_unavailable jobId={} sourceIndex={} sourceName={} reason={}",
                    jobId, sourceIndex, sourceName, v2.reason());
        }
        artifactSink.write(sourceIndex, ReplayArtifactWriter.AI_FACTS_NAME,
                ReplayArtifactWriter.aiFactsContent(result));
    }

    /** 失败 → 稳定 error code 与 {@code code} / {@code code: message} 文本（既有本地模式逐字一致）。 */
    public static String failureMessage(final String jobId, final int sourceIndex, final String sourceName,
                                        final Exception failure) {
        if (failure instanceof IOException) {
            LOGGER.warn("event=processing_job_storage_failed jobId={} sourceIndex={} sourceName={}",
                    jobId, sourceIndex, sourceName, failure);
            return "PROCESSING_JOB_STORAGE_UNAVAILABLE";
        }
        final String errorCode = failure instanceof ReplayProcessingSourceException sourceError
                ? sourceError.errorCode() : "REPLAY_PROCESSING_FAILED";
        final String message = StringUtils.hasText(failure.getMessage()) ? failure.getMessage() : errorCode;
        final String result = errorCode.equals(message) ? errorCode : errorCode + ": " + message;
        LOGGER.warn("event=processing_job_source_failed jobId={} sourceIndex={} sourceName={} errorCode={} error={}",
                jobId, sourceIndex, sourceName, errorCode, message);
        return result;
    }

    static V2BuildOutcome buildBattlePlaybackV2(final Battle battle, final ReplayProcessingResult result) {
        if (battle == null || result == null || result.reconstruction() == null) {
            return V2BuildOutcome.unavailable("NO_RECONSTRUCTION");
        }
        final var recorder = battle.recorderResult();
        if (recorder == null) {
            return V2BuildOutcome.unavailable("RECORDER_MISSING");
        }
        final BattleTimelineResult timeline;
        try {
            timeline = BattleTimelineBuilder.build(battle, result.reconstruction(),
                    TimelinePerspective.personal(
                            recorder.accountId > 0 ? recorder.accountId : null, recorder.team));
        } catch (final RuntimeException e) {
            return V2BuildOutcome.error("TIMELINE_BUILD_ERROR", e);
        }
        if (timeline == null || !timeline.usable()) {
            return V2BuildOutcome.unavailable("TIMELINE_NOT_USABLE");
        }
        try {
            final var mapping = TeamEntityMapper.resolve(battle, result.reconstruction());
            final BattlePlaybackDataset dataset = BattlePlaybackProjector.project(
                    battle, timeline.timeline(), mapping, recorder.accountId > 0 ? recorder.accountId : null);
            return dataset == null ? V2BuildOutcome.unavailable("PROJECTION_EMPTY")
                    : V2BuildOutcome.available(dataset);
        } catch (final RuntimeException e) {
            return V2BuildOutcome.error("PROJECTOR_ERROR", e);
        }
    }

    record V2BuildOutcome(BattlePlaybackDataset dataset, String reason, RuntimeException failure) {
        static V2BuildOutcome available(final BattlePlaybackDataset dataset) {
            return new V2BuildOutcome(dataset, null, null);
        }

        static V2BuildOutcome unavailable(final String reason) {
            return new V2BuildOutcome(null, reason, null);
        }

        static V2BuildOutcome error(final String reason, final RuntimeException failure) {
            return new V2BuildOutcome(null, reason, failure);
        }
    }
}

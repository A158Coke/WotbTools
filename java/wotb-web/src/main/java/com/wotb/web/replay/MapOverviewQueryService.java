package com.wotb.web.replay;

import com.wotb.core.model.Source;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.web.replay.ai.MapOverviewBuilder;
import com.wotb.web.replay.dto.MapOverview;
import com.wotb.web.replay.job.ReplayArtifactWriter;
import com.wotb.web.replay.job.ReplayProcessingJob;
import com.wotb.web.replay.job.ReplayProcessingJobStore;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

/**
 * 地图鸟瞰查询服务：只解析回放并确定性聚合 {@link MapOverview}（热力/路线/出生点/
 * 阶段/战局回放），<b>不调用任何 AI</b>。
 * <p>供 {@code /api/replay/map-overview} 使用：AI Review 页面在不跑 AI 复盘时也能
 * 单独加载地图视图；与 analyze 的 {@code done.mapOverview} 同源（同一
 * {@link MapOverviewBuilder}），无数据漂移。</p>
 * <p>错误码与 analyze 保持一致：文件校验（{@link ReplayUploadValidator}）与
 * {@code NO_BATTLE_DATA}；地图不可构建（未知地图/无观测/无名册/视角未解析）返回
 * {@code null}，由调用方转 204。</p>
 */
@Service
public class MapOverviewQueryService {

    private final DefaultReplayProcessingFacade processingFacade;
    private final ReplayProcessingJobStore processingStore;

    public MapOverviewQueryService(final DefaultReplayProcessingFacade processingFacade) {
        this(processingFacade, null);
    }

    @Autowired
    public MapOverviewQueryService(final DefaultReplayProcessingFacade processingFacade,
                                   @Autowired(required = false) final ReplayProcessingJobStore processingStore) {
        this.processingFacade = processingFacade;
        this.processingStore = processingStore;
    }

    /** 解析第一个（也是唯一一个）文件并构建地图鸟瞰；不可构建返回 null。 */
    public MapOverview buildOverview(final MultipartFile[] files) throws IOException {
        ReplayUploadValidator.validateAiReview(files);
        final MultipartFile file = files[0];
        final String name = file.getOriginalFilename() != null
                ? file.getOriginalFilename() : "replay.wotbreplay";
        final ReplayProcessingResult result = processingFacade.process(
                new Source(name, file.getBytes()), ReplayProcessingOptions.full());
        if (result.battle() == null) {
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        }
        return MapOverviewBuilder.build(result.battle(), result.reconstruction());
    }

    /**
     * Dataset 路径（plan §39/§88）：读 cached {@code map-overview.json}，<b>不</b>重新
     * full process（BLOCKER B）；文件不存在（capability unavailable）返回 null → 204。
     * Dataset Lease 保护读取期间不被 TTL 清理（plan §25）。
     */
    public MapOverview buildOverviewFromDataset(final String processingJobId, final int sourceIndex) {
        if (processingStore == null) {
            throw new IllegalArgumentException("DATASET_UNAVAILABLE");
        }
        final ReplayProcessingJob job = processingStore.acquireForSource(processingJobId);
        if (job == null) {
            throw new IllegalArgumentException("JOB_NOT_FOUND");
        }
        try {
            final ReplayProcessingJob.Snapshot snap = job.snapshot();
            if (sourceIndex < 0 || sourceIndex >= snap.sources().size()) {
                throw new IllegalArgumentException("SOURCE_NOT_FOUND");
            }
            final ReplayProcessingJob.SourceState state = snap.sources().get(sourceIndex);
            if (state.status() != ReplayProcessingJob.SourceStatus.READY) {
                throw new IllegalArgumentException(
                        state.status() == ReplayProcessingJob.SourceStatus.FAILED
                                ? "SOURCE_PROCESSING_FAILED" : "SOURCE_NOT_READY");
            }
            return ReplayArtifactWriter.readMapOverview(processingStore.jobDir(processingJobId), sourceIndex);
        } catch (final java.io.IOException e) {
            throw new IllegalArgumentException("DATASET_EXPIRED");
        } finally {
            processingStore.release(processingJobId);
        }
    }
}

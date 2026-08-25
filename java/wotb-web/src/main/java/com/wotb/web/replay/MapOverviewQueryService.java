package com.wotb.web.replay;

import com.wotb.web.replay.ai.MapOverviewBuilder;
import com.wotb.web.replay.dto.MapOverview;
import com.wotb.web.replay.job.ReplayArtifactWriter;
import com.wotb.web.replay.job.ReplayProcessingJob;
import com.wotb.web.replay.job.ReplayProcessingJobStore;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;

/**
 * 地图鸟瞰查询服务（V2 收口，BLOCKER 2）：只读 Processing Job 的 cached
 * {@code map-overview.json}，<b>不</b>重新 full process（multipart 上传路径已随
 * {@code /api/replay/map-overview} multipart 废弃为 410）。
 */
@Service
public class MapOverviewQueryService {

    private final ReplayProcessingJobStore processingStore;

    @Autowired
    public MapOverviewQueryService(
            @Autowired(required = false) final ReplayProcessingJobStore processingStore) {
        this.processingStore = processingStore;
    }

    /**
     * Dataset 路径（plan §39/§88）：读 cached {@code map-overview.json}，<b>不</b>重新
     * full process（BLOCKER B）；文件不存在（capability unavailable）返回 null → 204。
     * Dataset Lease 保护读取期间不被 TTL 清理（plan §25）。
     */
    public MapOverview buildOverviewFromDataset(final String processingJobId, final int sourceIndex) {
        // BLOCKER 4：缺失引用 → 400（controller 已前置校验；此处为防御，杜绝 null 进 store NPE→500）。
        if (processingJobId == null || processingJobId.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "DATASET_REFERENCE_REQUIRED");
        }
        if (processingStore == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "DATASET_UNAVAILABLE");
        }
        final ReplayProcessingJob job = processingStore.acquireForSource(processingJobId);
        if (job == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "JOB_NOT_FOUND");
        }
        try {
            final ReplayProcessingJob.Snapshot snap = job.snapshot();
            if (sourceIndex < 0 || sourceIndex >= snap.sources().size()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SOURCE_NOT_FOUND");
            }
            final ReplayProcessingJob.SourceState state = snap.sources().get(sourceIndex);
            if (state.status() != ReplayProcessingJob.SourceStatus.READY) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        state.status() == ReplayProcessingJob.SourceStatus.FAILED
                                ? "SOURCE_PROCESSING_FAILED" : "SOURCE_NOT_READY");
            }
            return ReplayArtifactWriter.readMapOverview(processingStore.jobDir(processingJobId), sourceIndex);
        } catch (final java.io.IOException e) {
            // artifact 缺失 = dataset 已过期 → 404（BLOCKER 4 稳定语义）。
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "JOB_NOT_FOUND");
        } finally {
            processingStore.release(processingJobId);
        }
    }
}

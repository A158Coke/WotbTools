package com.wotb.web.replay;

import com.wotb.web.replay.ai.MapOverviewBuilder;
import com.wotb.web.replay.dto.MapOverview;
import com.wotb.web.replay.job.ReplayArtifactWriter;
import com.wotb.web.replay.job.ReplayProcessingJob;
import com.wotb.web.replay.job.ReplayProcessingJobStore;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

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

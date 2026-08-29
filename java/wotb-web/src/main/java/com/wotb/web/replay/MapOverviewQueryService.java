package com.wotb.web.replay;

import com.wotb.web.replay.dto.MapOverview;
import com.wotb.web.replay.job.ReplayArtifactWriter;
import com.wotb.web.replay.job.ReplayProcessingJob;
import com.wotb.web.replay.job.ReplayProcessingJobStore;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * 地图鸟瞰查询服务（V2 收口）：只读 Processing Job 的 cached
 * {@code map-overview.json}，<b>不</b>重新 full process（multipart 上传路径已随
 * {@code /api/replay/map-overview} multipart 废弃为 410）。
 */
@Service
public class MapOverviewQueryService {

    private final ReplayProcessingJobStore processingStore;

    public MapOverviewQueryService(final ReplayProcessingJobStore processingStore) {
        this.processingStore = processingStore;
    }

    /**
     * Dataset 路径：读 cached {@code map-overview.json}，<b>不</b>重新
     * full process；文件不存在（capability unavailable）返回 null → 204。
     * Dataset Lease 保护读取期间不被 TTL 清理。
     */
    public MapOverview buildOverviewFromDataset(final String processingJobId, final int sourceIndex) {
        // 缺失引用 → 400（controller 已前置校验；此处为防御，杜绝 null 进 store NPE→500）。
        if (processingJobId == null || processingJobId.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "DATASET_REFERENCE_REQUIRED");
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
        } catch (final java.io.IOException | tools.jackson.core.JacksonException e) {
            // 文件不存在不会进入 catch（readMapOverview 缺文件返回 null → 调用方 204
            // capability unavailable）；此处 catch 代表 artifact 路径 / 读取 / 存储 I/O 故障
            // 或 JSON 解码/反序列化失败（permission / disk I/O / corrupt JSON）。这些<b>不是</b>
            // 「job 不存在」——映射为不可恢复的 503 DATASET_UNAVAILABLE，绝不 JOB_NOT_FOUND
            // （否则前端会误触发 exactly-once full-process recovery，浪费 CPU 并掩盖真实存储故障）。
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "DATASET_UNAVAILABLE");
        } finally {
            processingStore.release(processingJobId);
        }
    }
}

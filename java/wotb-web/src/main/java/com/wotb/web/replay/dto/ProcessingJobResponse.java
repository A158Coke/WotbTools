package com.wotb.web.replay.dto;

import com.wotb.web.replay.job.ReplayProcessingJob;

/** Replay Processing Job 状态 DTO（纯英文 key，前端三语映射；不暴露内部 result/Path）。 */
public record ProcessingJobResponse(String jobId, String status, String phase,
                                    int total, int processed, int valid, int duplicates, int failures,
                                    String errorCode, String currentFile) {

    public static ProcessingJobResponse from(final ReplayProcessingJob.Snapshot snap) {
        return new ProcessingJobResponse(
                snap.jobId(),
                snap.status().name(),
                snap.phase(),
                snap.total(),
                snap.processed(),
                snap.valid(),
                snap.duplicates(),
                snap.failures(),
                snap.errorCode(),
                snap.currentFile());
    }
}

package com.wotb.web.replay.dto;

import com.wotb.web.replay.job.ExportJob;

/** Export Job 状态 DTO（纯英文 key，前端三语映射；不暴露内部 Path/状态类）。 */
public record ExportJobResponse(String jobId, String status, String phase,
                                int total, int processed, int duplicates, int failures,
                                String errorCode, String filename, String contentType) {

    public static ExportJobResponse from(final ExportJob.Snapshot snap) {
        return new ExportJobResponse(
                snap.jobId(),
                snap.status().name(),
                snap.phase() == null ? null : snap.phase().name(),
                snap.total(),
                snap.processed(),
                snap.duplicates(),
                snap.failures(),
                snap.errorCode(),
                snap.filename(),
                snap.contentType());
    }
}

package com.wotb.web.replay.dto;

import com.wotb.web.replay.job.ReplayProcessingJob;

/** 轻量 per-source 状态（API 纯英文 key；不含 Battle / 错误详情堆栈）。 */
public record ProcessingSourceDto(String sourceId, int sourceIndex, String displayName,
                                  String status, String errorCode) {

    public static ProcessingSourceDto from(final ReplayProcessingJob.SourceState s) {
        return new ProcessingSourceDto(s.sourceId(), s.sourceIndex(), s.sourceName(),
                s.status().name(), s.failureMessage());
    }
}

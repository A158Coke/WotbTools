package com.wotb.web.replay.dto;

import com.wotb.web.replay.job.ReplayProcessingJob;

/** 当前并行处理中的 source（activeSources[]，通常 ≤2）。 */
public record ActiveSourceDto(String sourceId, int sourceIndex, String displayName) {

    public static ActiveSourceDto from(final ReplayProcessingJob.ActiveSource s) {
        return new ActiveSourceDto(s.sourceId(), s.sourceIndex(), s.displayName());
    }
}

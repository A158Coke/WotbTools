package com.wotb.web.replay.job;

import com.wotb.core.model.Source;
import com.wotb.core.replay.processing.ReplayProcessingResult;

/** One-source full-processing execution port consumed by the coordinator. */
public interface ReplayProcessingExecutor {

    ReplayProcessingResult process(Source source);
}

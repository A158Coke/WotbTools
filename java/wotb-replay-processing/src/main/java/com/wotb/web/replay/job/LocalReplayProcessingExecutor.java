package com.wotb.web.replay.job;

import com.wotb.core.model.Source;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import org.springframework.stereotype.Component;

/** Current in-process executor; preserves the canonical {@code full()} processing path. */
@Component
public class LocalReplayProcessingExecutor implements ReplayProcessingExecutor {

    private final DefaultReplayProcessingFacade processingFacade;

    public LocalReplayProcessingExecutor(final DefaultReplayProcessingFacade processingFacade) {
        this.processingFacade = processingFacade;
    }

    @Override
    public ReplayProcessingResult process(final Source source) {
        return processingFacade.process(source, ReplayProcessingOptions.full());
    }
}

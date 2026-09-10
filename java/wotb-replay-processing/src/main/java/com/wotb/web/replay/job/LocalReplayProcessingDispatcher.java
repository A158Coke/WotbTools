package com.wotb.web.replay.job;

import com.wotb.contracts.ReplayProcessingDispatcher;
import com.wotb.contracts.ReplayProcessingRequest;
import org.springframework.stereotype.Component;

/** Local single-JVM dispatcher backed by the existing fair scheduler. */
@Component
public class LocalReplayProcessingDispatcher implements ReplayProcessingDispatcher {

    private final ReplayParseScheduler scheduler;

    public LocalReplayProcessingDispatcher(final ReplayParseScheduler scheduler) {
        this.scheduler = scheduler;
    }

    @Override
    public void submit(final ReplayProcessingRequest request) {
        scheduler.submit(request);
    }

    @Override
    public CancellationResult cancelQueued(final String jobId) {
        return scheduler.cancelQueued(jobId) == ReplayParseScheduler.CancellationResult.ACTIVE_COMPLETION_PENDING
                ? CancellationResult.ACTIVE_COMPLETION_PENDING
                : CancellationResult.NO_COMPLETION_PENDING;
    }
}

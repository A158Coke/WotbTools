package com.wotb.web.replay.job;

import org.springframework.stereotype.Component;

import java.util.List;

/** Local single-JVM dispatcher backed by the existing fair scheduler. */
@Component
public class LocalReplayProcessingDispatcher implements ReplayProcessingDispatcher {

    private final ReplayParseScheduler scheduler;

    public LocalReplayProcessingDispatcher(final ReplayParseScheduler scheduler) {
        this.scheduler = scheduler;
    }

    @Override
    public void submit(final String jobId, final List<Integer> sourceIndexes, final SourceRunner runner,
                       final Runnable onStart, final Runnable onComplete) {
        scheduler.submit(jobId, sourceIndexes, runner::run, onStart, onComplete);
    }

    @Override
    public CancellationResult cancelQueued(final String jobId) {
        return scheduler.cancelQueued(jobId) == ReplayParseScheduler.CancellationResult.ACTIVE_COMPLETION_PENDING
                ? CancellationResult.ACTIVE_COMPLETION_PENDING
                : CancellationResult.NO_COMPLETION_PENDING;
    }
}

package com.wotb.web.replay.job;

import com.wotb.core.replay.processing.ReplayProcessingJobCompleted;
import com.wotb.core.replay.processing.ReplayProcessingJobStarted;
import com.wotb.core.replay.processing.ReplayProcessingLifecycle;
import com.wotb.core.replay.processing.ReplayProcessingSourceOutcome;
import com.wotb.core.replay.processing.ReplayProcessingSourceStarted;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

/** Bridges the local execution seam to synchronous in-process value events. */
@Component
@Primary
public final class LocalReplayProcessingLifecyclePublisher implements ReplayProcessingLifecycle {

    private final ApplicationEventPublisher eventPublisher;

    public LocalReplayProcessingLifecyclePublisher(final ApplicationEventPublisher eventPublisher) {
        this.eventPublisher = eventPublisher;
    }

    @Override
    public void jobStarted(final String jobId) {
        eventPublisher.publishEvent(new ReplayProcessingJobStarted(jobId));
    }

    @Override
    public void sourceStarted(final String jobId, final int sourceIndex, final String sourceName) {
        eventPublisher.publishEvent(new ReplayProcessingSourceStarted(jobId, sourceIndex, sourceName));
    }

    @Override
    public void sourceCompleted(final ReplayProcessingSourceOutcome outcome) {
        eventPublisher.publishEvent(outcome);
    }

    @Override
    public void jobCompleted(final String jobId) {
        eventPublisher.publishEvent(new ReplayProcessingJobCompleted(jobId));
    }
}

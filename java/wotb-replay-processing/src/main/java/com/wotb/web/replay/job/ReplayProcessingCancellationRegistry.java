package com.wotb.web.replay.job;

import org.springframework.stereotype.Component;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** Scheduler-owned cancellation state for current local execution only. */
@Component
final class ReplayProcessingCancellationRegistry {

    private final Set<String> cancelledJobIds = ConcurrentHashMap.newKeySet();

    void cancel(final String jobId) {
        cancelledJobIds.add(jobId);
    }

    boolean isCancelled(final String jobId) {
        return cancelledJobIds.contains(jobId);
    }

    void complete(final String jobId) {
        cancelledJobIds.remove(jobId);
    }
}

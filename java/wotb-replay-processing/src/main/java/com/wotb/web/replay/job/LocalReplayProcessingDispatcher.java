package com.wotb.web.replay.job;

import com.wotb.contracts.ReplayProcessingDispatcher;
import com.wotb.contracts.ReplayProcessingRequest;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Local single-JVM dispatcher backed by the existing fair scheduler.
 *
 * <p>只在 {@code local} 执行模式下存在：分布式模式的 dispatcher 是
 * {@code RabbitReplayProcessingDispatcher}（确认式 AMQP 投递），二者不会同时装配。</p>
 */
@Component
@ConditionalOnProperty(name = ReplayExecutionMode.PROPERTY,
        havingValue = ReplayExecutionMode.LOCAL_VALUE, matchIfMissing = true)
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

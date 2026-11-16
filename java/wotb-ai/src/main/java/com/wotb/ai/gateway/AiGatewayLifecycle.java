package com.wotb.ai.gateway;

import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Owns the daemon watchdog scheduler used to enforce each remaining call budget. */
final class AiGatewayLifecycle {
    private volatile ScheduledExecutorService watchdog;

    ScheduledFuture<?> scheduleBudgetWatchdog(final AttemptBudgetContext context,
                                               final long remainingNanos) {
        return watchdog().schedule(context::expireAndCancel, remainingNanos, TimeUnit.NANOSECONDS);
    }

    void shutdown() {
        final ScheduledExecutorService current = watchdog;
        if (current != null) {
            current.shutdown();
        }
    }

    private ScheduledExecutorService watchdog() {
        ScheduledExecutorService current = watchdog;
        if (current == null) {
            synchronized (this) {
                current = watchdog;
                if (current == null) {
                    final ScheduledThreadPoolExecutor executor = new ScheduledThreadPoolExecutor(
                            1, runnable -> {
                        final Thread thread = new Thread(runnable, "wotb-ai-budget-watchdog");
                        thread.setDaemon(true);
                        return thread;
                    });
                    executor.setRemoveOnCancelPolicy(true);
                    executor.setExecuteExistingDelayedTasksAfterShutdownPolicy(false);
                    current = executor;
                    watchdog = current;
                }
            }
        }
        return current;
    }
}

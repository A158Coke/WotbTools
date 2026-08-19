package com.wotb.web.replay.service;

import com.wotb.web.replay.exception.ReplayBusyException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.concurrent.Callable;
import java.util.concurrent.Semaphore;

/** 以非阻塞信号量限制单实例内同时执行的回放解析任务。 */
@Component
public class ReplayCapacityLimiter {

    private final Semaphore permits;

    public ReplayCapacityLimiter(
            @Value("${wotb.replay.max-concurrent-jobs:2}") final int maxConcurrentJobs) {
        if (maxConcurrentJobs < 1) {
            throw new IllegalArgumentException("Replay concurrency must be at least one");
        }
        permits = new Semaphore(maxConcurrentJobs);
    }

    public <T> T execute(final Callable<T> task) throws Exception {
        if (!permits.tryAcquire()) {
            throw new ReplayBusyException();
        }
        try {
            return task.call();
        } finally {
            permits.release();
        }
    }
}

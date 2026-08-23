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


    /** 阻塞获取许可（Export Job worker 在队列出队后等待全局容量；可被中断）。 */
    public void acquire() throws InterruptedException {
        permits.acquire();
    }

    /** 释放许可（与 {@link #acquire()} 配对；重复释放由 Semaphore 自行处理）。 */
    public void release() {
        permits.release();
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

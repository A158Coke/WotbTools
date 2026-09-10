package com.wotb.web.replay.job;

import java.util.List;

/**
 * Processing Job 的执行投递端口。
 *
 * <p>协调器只生产 job/source work 并维护生命周期；本端口负责把 work 投递给当前执行环境。
 * 本地实现仍复用既有的公平调度器，因此并发上限、排队容量和取消语义不变。
 * 将来接入进程外 worker 时替换此实现即可，HTTP 契约和 job 状态机无需改变。</p>
 */
public interface ReplayProcessingDispatcher {

    void submit(String jobId, List<Integer> sourceIndexes, SourceRunner runner,
                Runnable onStart, Runnable onComplete);

    CancellationResult cancelQueued(String jobId);

    /** {@link #cancelQueued(String)} 的回调终态语义。 */
    enum CancellationResult {
        /** 当前执行器不再触发 completion；协调器必须自行推进 job 终态。 */
        NO_COMPLETION_PENDING,
        /** 仍有已提交 source；执行器会在最后一个 source 完成后调用 completion。 */
        ACTIVE_COMPLETION_PENDING
    }

    @FunctionalInterface
    interface SourceRunner {
        void run(int sourceIndex) throws Exception;
    }
}

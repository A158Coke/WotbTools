package com.wotb.web.replay.job;

/**
 * Replay Processing Job 状态迁移完成后的通知回调（write-through 持久化的挂载点）。
 *
 * <p>为什么需要它：状态迁移由 worker / status / cancel 线程直接调用
 * {@link ReplayProcessingJob} 的 mutator，注册表不是唯一入口；把持久化挂在 job 自身的
 * 迁移点上，才能保证「任何一处状态变化都被观察到」，不必在每个调用点重复一遍持久化调用
 * （那会形成第二份「哪些迁移需要落库」的规则）。</p>
 *
 * <p>回调在**状态已经变更之后**触发。实现必须自己决定失败策略：注册表实现选择
 * 「记录 ERROR 并继续」，因为此刻内存状态已经前进，把异常抛回 worker 只会让执行线程
 * 在半途失败，而下一次迁移会再次覆盖整行投影。</p>
 */
@FunctionalInterface
public interface ReplayJobTransitionListener {

    void onJobTransition(ReplayProcessingJob job);
}

package com.wotb.web.replay.job;

/**
 * Replay Processing Job 状态迁移完成后的通知回调（write-through 持久化的挂载点）。
 *
 * <p>为什么需要它：状态迁移由 worker / status / cancel 线程直接调用
 * {@link ReplayProcessingJob} 的 mutator，注册表不是唯一入口；把持久化挂在 job 自身的
 * 迁移点上，才能保证「任何一处状态变化都被观察到」，不必在每个调用点重复一遍持久化调用
 * （那会形成第二份「哪些迁移需要落库」的规则）。</p>
 *
 * <p>回调在**状态已经变更之后**、且**在 job 自己的监视器边界内**触发：revision 与它描述的
 * 状态、来源、计数器来自同一个线性化点，因此回调拿到的
 * {@link ReplayJobPersistenceSnapshot} 永久不可变。实现**不得**回读
 * {@link ReplayProcessingJob} 的可变状态——那会重新引入「旧状态配新版本号」的错配。</p>
 *
 * <p>由于回调持有 job 监视器，实现必须只依赖传入的快照，且不得反向获取可能与该监视器成环的
 * 锁（{@code acquireForSource} / {@code acquireForExport} 的加锁顺序是
 * 「lifecycleLock → job 监视器」，反向获取会死锁）。</p>
 */
@FunctionalInterface
public interface ReplayJobTransitionListener {

    void onJobTransition(ReplayJobPersistenceSnapshot snapshot);
}

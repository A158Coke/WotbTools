package com.wotb.web.replay.job;

import java.io.IOException;

/**
 * 分布式 batch 收尾端口：把「全部 source 终态」变成「对象存储里的 finalized batch dataset」。
 *
 * <p>本地路径在同一个 FINALIZING_BATCH 阶段直接调用 {@link ReplayBatchFinalizer} 并把结果留在
 * 进程内存；两条链路的差别只有 dataset 落在哪里（本地内存 / MinIO），批次语义完全共用。</p>
 *
 * <p><b>dataset 权威在对象存储</b>：实现必须把 finalized dataset 写进对象存储，而不是只把它
 * 返回给调用方——调用方随后只把 job 状态推进到 READY（{@code markReady()} 不带内存 dataset），
 * 因此 READY 之后的一切读取（GET result / Export / Rating V2）都走对象存储，TX 本地磁盘不再被依赖。</p>
 */
public interface ReplayBatchFinalization {

    /**
     * 读回 per-source canonical dataset → {@link ReplayBatchFinalizer} → 写 finalized batch dataset。
     *
     * @return 已 enrich 的 authoritative dataset（仅用于日志/断言；权威副本已落对象存储）
     * @throws IOException 对象存储不可用。调用方**必须**让本次投递不 settle（nack → DLQ +
     *                     operator 重放），绝不把瞬时存储故障写成 job 终态
     * @throws ReplayBatchFinalizer.NoValidReplaysException 去重/聚合后 0 场有效回放（业务终态）
     */
    ProcessedDataset finalizeBatch(ReplayProcessingJob job) throws IOException;
}

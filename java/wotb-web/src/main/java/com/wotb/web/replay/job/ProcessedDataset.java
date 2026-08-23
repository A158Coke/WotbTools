package com.wotb.web.replay.job;

import com.wotb.core.model.Battle;

import java.util.List;

/**
 * Replay Processing Job 的已处理回放数据集（plan §22 短生命周期 job cache，
 * TTL 与 Job 一致）。
 *
 * <p>battles 为已统一 enrich 的 authoritative Battle 列表（worker 完成后执行
 * PotentialDamage + PerformanceMetricsCalculator.populateBattle 各一次）：
 * Preview / Export / Aggregate 都直接消费同一份 facts，绝不二次 processFull
 * （plan §26/§27：禁止缓存 raw parser 结果替代 authoritative Battle）。</p>
 *
 * <p>注意：Battle 仅含结算战绩（players + killVictims 等），不携带 reconstruction
 * 事件流（ReplayReconstruction 在处理后即可 GC）；34/50 场 dataset 的 heap 成本
 * 远低于完整重建对象（Strategy A，plan §24）。</p>
 */
public record ProcessedDataset(List<Battle> battles,
                               List<String> battleSourceNames,
                               List<String[]> duplicates,
                               List<String[]> failures) {

    /**
     * 防御性拷贝（shallow）：READY 后消费者（Preview / Aggregate Export / Each Export）
     * 只读该 dataset——任何 add/remove/reorder 都不得泄漏到共享 cache（review BLOCKER 3）。
     * Battle 本身仍 mutable（不把整个 Battle graph 改造成 immutable DTO）；
     * 不可变性由「创建前保证 enrich invariant + 消费者只读」契约保证。
     */
    public ProcessedDataset {
        battles = battles == null ? List.of() : List.copyOf(battles);
        battleSourceNames = battleSourceNames == null ? List.of() : List.copyOf(battleSourceNames);
        duplicates = duplicates == null ? List.of() : List.copyOf(duplicates);
        failures = failures == null ? List.of() : List.copyOf(failures);
    }

    /** 有效场数（= 去重后进入结果集的场次；READY dataset 恒 >= 1）。 */
    public int validCount() {
        return battles.size();
    }
}

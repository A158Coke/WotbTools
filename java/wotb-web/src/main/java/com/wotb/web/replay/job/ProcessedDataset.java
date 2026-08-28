package com.wotb.web.replay.job;

import com.wotb.core.league.LeagueRatingBatch;
import com.wotb.core.model.Battle;

import java.util.List;

/**
 * Replay Processing Job 的已处理回放数据集（短生命周期 job cache，TTL 与 Job 一致）。
 *
 * <p><b>enrich 不变式</b>：{@code battles} 是 worker 完成时已统一 enrich 的 authoritative
 * Battle 列表——PerformanceMetricsCalculator.populateBattle 各恰好执行一次，
 * 之后 Preview / Aggregate Export / Each Export 都只读消费同一份 facts，绝不二次 processFull、
 * 绝不再次执行会修改 Battle facts 的 enrichment（缓存 raw parser 结果替代 authoritative
 * Battle 会丢失 reconstruction/HP/死亡时间校准，导致 UI 与 Excel 数值漂移）。</p>
 *
 * <p><b>heap 契约</b>：Battle 仅含结算战绩（players 等），不携带 reconstruction
 * 事件流（ReplayReconstruction 在处理后即可 GC）；34/50 场 dataset 的 heap 成本远低于完整
 * 重建对象，消费者不得反向引入重建事件流。</p>
 *
 * <p><b>混合批次</b>（普通 + 训练赛/联赛混传）：{@code leagueUnavailableCode} =
 * {@code MIXED_LEAGUE_AND_STANDARD_REPLAYS}（League Rating 不聚合混合批次，battles 仍按
 * 普通回放语义成功返回）；其余场景为 null。</p>
 */
public record ProcessedDataset(List<Battle> battles,
                               List<String> battleSourceNames,
                               List<String[]> duplicates,
                               List<String[]> failures,
                               LeagueRatingBatch league,
                               String leagueUnavailableCode) {

    /**
     * 防御性拷贝（shallow）：READY 后消费者（Preview / Aggregate Export / Each Export）
     * 只读该 dataset——任何 add/remove/reorder 都不得泄漏到共享 cache。
     * Battle 本身仍 mutable（不把整个 Battle graph 改造成 immutable DTO）；
     * 不可变性由「创建前保证 enrich invariant + 消费者只读」契约保证。
     */
    public ProcessedDataset {
        battles = battles == null ? List.of() : List.copyOf(battles);
        battleSourceNames = battleSourceNames == null ? List.of() : List.copyOf(battleSourceNames);
        duplicates = duplicates == null ? List.of() : List.copyOf(duplicates);
        failures = failures == null ? List.of() : List.copyOf(failures);
    }

    /** 是否为 League Rating 批次。 */
    public boolean isLeague() {
        return league != null;
    }

    /** 有效场数（= 去重后进入结果集的场次；READY dataset 恒 >= 1）。 */
    public int validCount() {
        return battles.size();
    }
}

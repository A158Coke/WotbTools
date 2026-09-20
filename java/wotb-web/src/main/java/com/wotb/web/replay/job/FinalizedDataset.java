package com.wotb.web.replay.job;

import com.wotb.core.league.LeagueRatingBatch;
import com.wotb.core.model.Battle;

import java.util.List;

/**
 * 对象存储里 **finalized batch dataset** 的读写镜像
 * （{@code temp/jobs/<jobId>/result/finalized.json}）。
 *
 * <p>写入方是控制面的 {@code FINALIZING_BATCH} 阶段（{@link ReplayBatchFinalization}）：全部 source
 * 终态之后，控制面读回 per-source canonical dataset、执行与本地完全相同的
 * {@link ReplayBatchFinalizer}（dedupe / 冲突判定 / League Rating / 聚合 / enrichment），再把
 * **最终结果**落成这一个对象。READY 之后的所有读取（{@code GET .../result}、Export、Rating V2）
 * 都只读它——per-source 对象是收尾的输入，不是读取侧的数据集。</p>
 *
 * <p>字段集与 {@link ProcessedDataset} 一一对应；{@code league} 只在
 * {@code LEAGUE_RATING} 批次非 null（与本地 READY 时的约定逐字一致）。独立镜像而不是直接序列化
 * {@link ProcessedDataset}：这是 wire/对象契约，必须有显式版本号（{@link #SCHEMA_VERSION}）与
 * 显式字段映射，不能让派生 getter（{@code isLeague}/{@code validCount}）隐式参与序列化。</p>
 */
record FinalizedDataset(String schemaVersion,
                        List<Battle> battles,
                        List<String> battleSourceNames,
                        List<String> battleSourceIds,
                        List<String[]> duplicates,
                        List<String[]> failures,
                        LeagueRatingBatch league,
                        String leagueUnavailableCode) {

    /** dataset shape 版本；不匹配即拒绝，不做半应用。 */
    static final String SCHEMA_VERSION = "1";

    FinalizedDataset {
        battles = battles == null ? List.of() : List.copyOf(battles);
        battleSourceNames = battleSourceNames == null ? List.of() : List.copyOf(battleSourceNames);
        battleSourceIds = battleSourceIds == null ? List.of() : List.copyOf(battleSourceIds);
        duplicates = duplicates == null ? List.of() : List.copyOf(duplicates);
        failures = failures == null ? List.of() : List.copyOf(failures);
    }

    /** 唯一写入方向：本地/分布式的 authoritative dataset → 对象契约。 */
    static FinalizedDataset from(final ProcessedDataset dataset) {
        return new FinalizedDataset(SCHEMA_VERSION, dataset.battles(), dataset.battleSourceNames(),
                dataset.battleSourceIds(), dataset.duplicates(), dataset.failures(),
                dataset.league(), dataset.leagueUnavailableCode());
    }

    /** 唯一读取方向：对象契约 → 控制面消费的 dataset（battles 已 enrich，消费者只读）。 */
    ProcessedDataset toProcessedDataset() {
        return new ProcessedDataset(battles, battleSourceNames, battleSourceIds, duplicates, failures,
                league, leagueUnavailableCode);
    }
}

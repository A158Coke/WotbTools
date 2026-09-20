package com.wotb.web.replay.job;

import com.wotb.core.model.Battle;

import java.util.List;

/**
 * 对象存储里 canonical per-source dataset 的**读取侧**镜像
 * （{@code temp/jobs/<jobId>/result/source-<sourceIndex>.json}）。
 *
 * <p>写入方是 parser-worker：它把一条输入解析出的 canonical dataset 落成一个对象，字段集与
 * 本地控制面 READY 时持有的 {@link ProcessedDataset} 的 per-source 投影相同。控制面在
 * 分布式模式下必须读回这份对象才能回答 {@code GET .../result}，因此这里按同一 shape 反序列化。</p>
 *
 * <p>{@code league} 字段刻意**不**在本镜像里消费：batch 级 League Rating 聚合需要跨全部
 * source，属 PR F（Distributed Dataset Consumers）；本 PR 只做「读取并拼接 per-source
 * canonical dataset」，因此把 {@code leagueUnavailableCode} 原样透传、league 忽略。</p>
 */
record RemoteSourceDataset(String schemaVersion,
                           int sourceIndex,
                           String sourceName,
                           List<Battle> battles,
                           List<String> battleSourceNames,
                           List<String> battleSourceIds,
                           List<String[]> duplicates,
                           List<String[]> failures,
                           String leagueUnavailableCode) {

    /** dataset shape 版本；不匹配即拒绝，不做半应用。 */
    static final String SCHEMA_VERSION = "1";

    RemoteSourceDataset {
        battles = battles == null ? List.of() : List.copyOf(battles);
        battleSourceNames = battleSourceNames == null ? List.of() : List.copyOf(battleSourceNames);
        battleSourceIds = battleSourceIds == null ? List.of() : List.copyOf(battleSourceIds);
        duplicates = duplicates == null ? List.of() : List.copyOf(duplicates);
        failures = failures == null ? List.of() : List.copyOf(failures);
    }
}

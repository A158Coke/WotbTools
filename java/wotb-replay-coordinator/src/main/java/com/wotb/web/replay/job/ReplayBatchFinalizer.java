package com.wotb.web.replay.job;

import com.wotb.core.league.LeagueRatingMode;
import com.wotb.core.league.LeagueReplays;
import com.wotb.core.model.Battle;
import com.wotb.core.parse.Replays;
import com.wotb.core.stats.PerformanceMetricsCalculator;

import java.util.List;
import java.util.function.Consumer;

/**
 * batch 收尾（FINALIZING_BATCH）的**唯一实现**：dedupe → 冲突判定 → League Rating / Rating V2 →
 * 批次聚合 → enrichment。
 *
 * <p>本地（单 JVM 执行）与分布式（TX 控制面 + Yecao parser-worker）两条链路都必须经过这里，
 * 因此「怎么算一个批次」只有一份代码：worker 只负责把单条回放解析成 canonical per-source
 * dataset，批次语义（去重、联赛聚合、评分、指标 enrichment）永远由控制面在
 * {@code FINALIZING_BATCH} 阶段执行一次。</p>
 *
 * <p><b>输入形状</b>：{@link Replays.ParsedEntry} 只携带 {@code (sourceIndex, sourceName, Battle,
 * failureMessage)}，因此分布式控制面仅凭「PG 里的 source 终态 + 对象存储里的 per-source Battle」
 * 就能构造出与本地进程内完全相同的输入，无需把解析中间态搬过网络。</p>
 *
 * <p><b>本类不持有 job、不写存储、不做状态迁移</b>：phase 推进、终态选择、dataset 落地
 * （本地内存 / MinIO）都是调用方的事，唯一的语义判断在这里（含「0 场有效回放」）。</p>
 */
public final class ReplayBatchFinalizer {

    /** 混合批次（普通 + 训练赛/联赛混传）不聚合 League Rating 时的稳定提示码。 */
    public static final String MIXED_LEAGUE_AND_STANDARD_REPLAYS = "MIXED_LEAGUE_AND_STANDARD_REPLAYS";

    private ReplayBatchFinalizer() {
    }

    /** 0 场有效回放：终态 FAILED + NO_VALID_REPLAYS（本地与分布式共用的语义）。 */
    public static final class NoValidReplaysException extends RuntimeException {
    }

    /**
     * finalize 进度接收方：{@code (processed, duplicates, failures)} 三元组，语义与本地既有
     * {@code job.updateProgress(...)} 逐字一致。
     */
    @FunctionalInterface
    public interface BatchProgressSink {

        void progress(int processed, int duplicates, int failures);
    }

    /**
     * 把 finalize 进度回调适配成 job 的进度三元组（本地与分布式共用，避免两处各写一份计数规则）。
     */
    public static Replays.ReplayProgressListener progressListener(final BatchProgressSink sink) {
        final int[] counters = new int[3]; // processed / duplicates / failures
        return (sourceIndex, sourceName, outcome) -> {
            counters[0]++;
            if (outcome == Replays.Outcome.DUPLICATE) {
                counters[1]++;
            }
            if (outcome == Replays.Outcome.FAILURE) {
                counters[2]++;
            }
            sink.progress(counters[0], counters[1], counters[2]);
        };
    }

    /**
     * 对**全部 source 的 terminal outcome** 执行一次批次收尾。
     *
     * @param entries  按 sourceIndex 顺序的全部 source（失败的 source 以 {@code failureMessage} 表达）
     * @param log      进度日志（可为 {@code null}）
     * @param progress 进度回调（可为 {@code null}）
     * @return 已 enrich 的 authoritative dataset（battles 恰好 enrich 一次）
     * @throws NoValidReplaysException 去重/聚合后 0 场有效回放
     */
    public static ProcessedDataset finalizeBatch(final List<Replays.ParsedEntry> entries,
                                                 final Consumer<String> log,
                                                 final Replays.ReplayProgressListener progress) {
        final LeagueReplays.LeagueCollectResult collected = LeagueReplays.finalize(entries, log, progress);
        if (collected.battles().isEmpty()) {
            throw new NoValidReplaysException();
        }
        // 混合批次不再整体拒绝：League Rating 不聚合混合批次，battles 仍按普通回放语义成功返回并
        // READY，leagueUnavailableCode 提示 League Analysis unavailable。
        final String leagueUnavailableCode = collected.mode() == LeagueRatingMode.MIXED_UNSUPPORTED
                ? MIXED_LEAGUE_AND_STANDARD_REPLAYS : null;
        // 事实层 enrich 一次：Preview / Export 直接消费已 enrich 的 authoritative Battle。
        for (final Battle battle : collected.battles()) {
            PerformanceMetricsCalculator.populateBattle(battle);
        }
        return new ProcessedDataset(collected.battles(), collected.battleSourceNames(),
                collected.battleSourceIds(), collected.duplicates(), collected.failures(),
                collected.mode() == LeagueRatingMode.LEAGUE_RATING ? collected.leagueBatch() : null,
                leagueUnavailableCode);
    }
}

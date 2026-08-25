package com.wotb.core;

import com.wotb.core.model.Agg;
import com.wotb.core.stats.PerformanceMetricsCalculator;

import java.util.List;
import java.util.function.Function;

/**
 * Replay Aggregate 跨场汇总列的 canonical 契约：key + numeric + getter 单一事实源，
 * 同时被 API Mapper（wotb-web）与 Excel 汇总表（AggregateSheets）消费。
 *
 * <p>中文 title / xlsx width / 列顺序属于各展示层 presentation，不在本契约内；
 * 但 key 宇宙、numeric 判定与取值 getter 只允许在此定义一处，杜绝
 * 「API 新增字段、Excel 忘记加」这类字段漂移。</p>
 *
 * <p>表现派生列（{@link #PERFORMANCE}）的值来源是
 * {@link PerformanceMetricsCalculator.Row}（跨场 HP 聚合上下文），与
 * {@link #CORE}（{@link Agg} 直接可得）分开定义，但两者都由 Mapper /
 * Excel 共同消费同一 getter。</p>
 */
public final class AggregateColumns {

    /** 核心跨场事实列（{@link Agg} 直接可得；返回值即 API/Excel 共用的单元格值）。 */
    public record CoreColumn(String key, boolean numeric, Function<Agg, Object> get) {
    }

    /** 跨场表现派生列（值来自 {@link PerformanceMetricsCalculator.Row}；HP fail-closed 已编码进 getter）。 */
    public record PerfColumn(String key, boolean numeric, Function<PerformanceMetricsCalculator.Row, Object> get) {
    }

    private AggregateColumns() {
    }

    /** 核心跨场事实列（顺序 = API aggregateColumns 顺序；Excel 按自身 presentation 顺序引用）。 */
    public static final List<CoreColumn> CORE = List.of(
            new CoreColumn("nickname", false, a -> a.nickname),
            new CoreColumn("clan", false, a -> a.clan),
            new CoreColumn("battles", true, a -> a.battles),
            new CoreColumn("wins", true, a -> a.wins),
            new CoreColumn("win_rate", true, a -> r1(a.winRate())),
            new CoreColumn("survival_rate", true, a -> r1(a.survivalRate())),
            new CoreColumn("survival_avg", true, a -> a.avg(a.survivalSum)),
            new CoreColumn("kills", true, a -> a.kills),
            new CoreColumn("kills_avg", true, a -> r2(a.avg(a.kills))),
            new CoreColumn("damage", true, a -> a.damage),
            new CoreColumn("damage_avg", true, a -> r1(a.avg(a.damage))),
            new CoreColumn("assisted", true, a -> a.assisted),
            new CoreColumn("assisted_avg", true, a -> r1(a.avg(a.assisted))),
            new CoreColumn("received_avg", true, a -> r1(a.avg(a.received))),
            new CoreColumn("blocked_avg", true, a -> r1(a.avg(a.blocked))),
            new CoreColumn("hit_rate", true, a -> rateOrNull(a.hitRate())),
            new CoreColumn("pen_rate", true, a -> rateOrNull(a.penRate())),
            new CoreColumn("shots", true, a -> a.shots),
            new CoreColumn("hits", true, a -> a.hits),
            new CoreColumn("pens", true, a -> a.pens),
            new CoreColumn("enemies_damaged_avg", true, a -> r2(a.avg(a.enemiesDamaged))),
            new CoreColumn("tanks", false, Agg::tanksStr),
            new CoreColumn("account_id", true, a -> a.accountId),
            new CoreColumn("earned_total", true, a -> a.earned),
            new CoreColumn("earned_avg", true, a -> r1(a.avg(a.earned)))
    );

    /**
     * 跨场表现派生列（顺序 = API aggregateColumns 追加顺序）。
     *
     * <p>HP 全部 UNKNOWN（{@code hpEligible=false}）时 contribution/kast/多伤率 unavailable
     * （getter 返回 null，Excel 空单元格 = API null，不冒充 0）；impact / tradedDeaths
     * 不依赖 HP，恒有值。</p>
     */
    public static final List<PerfColumn> PERFORMANCE = List.of(
            new PerfColumn("contribution", true, row -> row.hpEligible ? r1(row.contribution) : null),
            new PerfColumn("kast", true, row -> row.hpEligible ? r1(row.kast) : null),
            new PerfColumn("impact", true, row -> r1(row.impactValue)),
            new PerfColumn("multi_damage_rate", true, row -> row.hpEligible ? r1(row.multiDamageRate) : null),
            new PerfColumn("traded_deaths", true, row -> (double) row.tradedDeaths)
    );

    /** 按 key 查找核心列（未知 key 立即失败，防止展示层漂移）。 */
    public static CoreColumn core(final String key) {
        for (final CoreColumn c : CORE) {
            if (c.key().equals(key)) {
                return c;
            }
        }
        throw new IllegalArgumentException("unknown aggregate core column: " + key);
    }

    /** 按 key 查找表现派生列。 */
    public static PerfColumn perf(final String key) {
        for (final PerfColumn c : PERFORMANCE) {
            if (c.key().equals(key)) {
                return c;
            }
        }
        throw new IllegalArgumentException("unknown aggregate performance column: " + key);
    }

    /** 跨场比例（0-100，一位小数）；分母为 0 的场次无比例 → null（unavailable，禁止 0/0 伪装 0%）。
     * 跨场基于<b>总量</b>：sum(pens)/sum(hits)，不是各场比例的简单平均（Agg 累计 shots/hits/pens 后再算）。 */
    private static Object rateOrNull(final Double v) {
        return v == null ? null : r1(v);
    }

    private static double r1(final double v) {
        return Math.round(v * 10) / 10.0;
    }

    private static double r2(final double v) {
        return Math.round(v * 100) / 100.0;
    }
}

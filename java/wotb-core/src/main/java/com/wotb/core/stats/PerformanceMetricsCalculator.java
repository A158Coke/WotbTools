package com.wotb.core.stats;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.facts.BattleHpFacts;
import com.wotb.core.replay.facts.BattleHpFacts.BattleAverageHp;
import com.wotb.core.replay.facts.TradeFacts;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 战斗表现指标（Performance Metrics）：纯派生计算，只读、无副作用。
 *
 * <p>只消费统一 replay authoritative facts（{@link Battle} / {@link PlayerResult} +
 * {@code com.wotb.core.replay.facts} 包），做纯数学推导；不解析回放、不查询 Tankopedia、
 * 不改写任何 battle/player 字段（PotentialDamage 已在回放管线完成，trade/HP 均来自事实层）。</p>
 *
 * <p><b>HP fail-closed</b>：场均 HP 为 {@link BattleAverageHp#complete()}=false（存在 UNKNOWN）
 * 的场次，依赖 HP 的衍生指标（贡献度击杀项 / KAST / 多伤率 / 场均 HP）不累计，绝不产出伪精确
 * 结果；不依赖 HP 的原始权威数据（damage / assist / kills / survival / traded / impact）
 * 仍正常计算。各衍生指标按「HP 已知场次」做分母。</p>
 *
 * <p>原 Rating V2 的综合评分（{@code rating} / {@code finalRating} / 各权重）已移除——
 * 本类不再输出任何总分，仅保留有业务价值的派生指标：贡献度 / KAST / Impact /
 * 多伤率 / 存活率 / 互换击杀 / 均伤 / 协助 / 潜在伤害。</p>
 */
public final class PerformanceMetricsCalculator {

    private static final double EXPECTED_BATTLE_SHARE = 1.0 / BattleHpFacts.STANDARD_BATTLE_PLAYER_COUNT;

    /** 一名玩家跨场的战斗表现聚合行。 */
    public static final class Row {
        public long accountId;
        public String nickname = "";
        public String clan = "";
        public int battles;
        public int wins;
        public long kills;
        public long damage;
        public long assistDamage;
        public long potentialDamage;
        public long potentialDamageSupplement;
        public double kast;
        public double contribution;
        public double impactValue;
        public String impact = "0.00%";
        public double damageAvg;
        public double assistAvg;
        public double potentialDamageAvg;
        public double potentialDamageSupplementAvg;
        public double killsAvg;
        public double averageHp;
        public double multiDamageRate;
        public double survivalRate;
        public int tradedDeaths;
        /** 是否存在 HP 已知场次（false = 所有场次 HP UNKNOWN，contribution/kast/多伤率 unavailable）。 */
        public boolean hpEligible;
        double kastSum;
        int kastBattles;
        double roundContribution;
        double teamRoundContribution;
        double impactSum;
        double averageHpSum;
        int averageHpBattles;
        long lastTime = Long.MIN_VALUE;
        int impactBattles;
        int multiDamageBattles;
        int multiDamageEligible;
        int survivalBattles;

        public double winRate() {
            return battles == 0 ? 0 : 100.0 * wins / battles;
        }

        void finish() {
            if (battles == 0) {
                return;
            }
            damageAvg = (double) damage / battles;
            assistAvg = (double) assistDamage / battles;
            potentialDamageAvg = (double) potentialDamage / battles;
            potentialDamageSupplementAvg = (double) potentialDamageSupplement / battles;
            killsAvg = (double) kills / battles;
            averageHp = averageHpBattles == 0 ? 0 : averageHpSum / averageHpBattles;
            kast = kastBattles == 0 ? 0 : cap(100.0 * kastSum / kastBattles, 100.0);
            contribution = teamRoundContribution == 0
                    ? 0 : 100.0 * roundContribution / teamRoundContribution;
            impactValue = impactBattles == 0 ? 0 : impactSum / impactBattles;
            impact = percent(impactValue);
            multiDamageRate = multiDamageEligible == 0
                    ? 0 : 100.0 * multiDamageBattles / multiDamageEligible;
            survivalRate = 100.0 * survivalBattles / battles;
            hpEligible = kastBattles > 0;
        }
    }

    private PerformanceMetricsCalculator() {
    }

    /** 对一批战斗的所有玩家计算战斗表现指标（read-only；调用方负责先跑完 facts 管线）。 */
    public static List<Row> compute(final List<Battle> battles) {
        final Map<Long, Row> rows = new LinkedHashMap<>();
        for (final Battle battle : battles) {
            final BattleContext ctx = BattleContext.of(battle);
            for (final PlayerResult player : battle.players) {
                final Row row = rows.computeIfAbsent(player.accountId, key -> {
                    final Row r = new Row();
                    r.accountId = key;
                    return r;
                });
                applyPlayer(row, battle, player, ctx);
            }
        }

        final List<Row> out = new ArrayList<>(rows.values());
        for (final Row row : out) {
            row.finish();
        }
        out.sort((a, b) -> Double.compare(b.contribution, a.contribution));
        return out;
    }

    /** 单场逐玩家表现指标（contribution/kast 在 HP unknown 时为 null；impact 恒有值）。 */
    public record PlayerMetrics(Double contribution, Double kast, double impact) {
    }

    /** 单场逐玩家指标（纯派生，无副作用）：与 {@link #compute} 共用同一批私有公式，单一事实源。 */
    private static PlayerMetrics metricsFor(final BattleContext ctx, final Battle battle,
                                            final PlayerResult player) {
        final BattleAverageHp avg = ctx.averageHp();
        Double contribution = null;
        Double kast = null;
        if (avg.complete()) {
            final int team = safeTeam(player.team);
            final double teamC = ctx.teamContribution[team];
            final Integer winner = battle.winnerTeam;
            final boolean win = winner != null && winner != 0 && player.team == winner;
            final int traded = TradeFacts.tradedDeaths(player, battle.players);
            contribution = teamC == 0 ? 0 : 100.0 * roundContribution(player, avg.value()) / teamC;
            kast = 100.0 * singleBattleKast(player, win, traded, avg.value());
        }
        return new PlayerMetrics(contribution, kast, singleBattleImpact(player, ctx));
    }

    /**
     * 单场逐玩家指标（纯派生，无副作用）：与 {@link #compute} 共用同一批私有公式
     * （roundContribution / singleBattleKast / singleBattleImpact / BattleContext），
     * 保证单场表与跨场聚合是同一事实源、同一算法。
     *
     * <p>HP fail-closed：场均 HP UNKNOWN 时 contribution/kast 为 null（UI 显示 "--"，
     * 不冒充 0）；impact 不依赖 HP 恒有值。</p>
     *
     * <p>注意：返回 Map 以 accountId 为键。若单场 protobuf 出现重复 accountId，后项覆盖前项；
     * 该 Map 仅供测试/聚合比对。实际回填请使用 {@link #populateBattle}（逐 PlayerResult 直写，
     * 不受重复 accountId 覆盖影响）。</p>
     */
    public static Map<Long, PlayerMetrics> battleMetrics(final Battle battle) {
        final BattleContext ctx = BattleContext.of(battle);
        final Map<Long, PlayerMetrics> out = new LinkedHashMap<>();
        for (final PlayerResult player : battle.players) {
            out.put(player.accountId, metricsFor(ctx, battle, player));
        }
        return out;
    }

    /**
     * 把单场逐玩家指标直接写入每个 {@link PlayerResult} 的 contribution/kast/impact
     * （供 Columns.PLAYER / Excel 单场表共用；幂等，重复调用覆盖）。
     *
     * <p>逐 PlayerResult 计算并直写，不经过 accountId Map——即使单场存在重复 accountId
     * （protobuf #301 未按 accountId 去重，见 {@link com.wotb.core.parse.ReplayParser}），
     * 每个 PlayerResult 也拿到自己的指标，不会发生 A 覆盖 B。</p>
     */
    public static void populateBattle(final Battle battle) {
        final BattleContext ctx = BattleContext.of(battle);
        for (final PlayerResult player : battle.players) {
            final PlayerMetrics m = metricsFor(ctx, battle, player);
            player.contribution = m.contribution();
            player.kast = m.kast();
            player.impact = m.impact();
        }
    }

    private static void applyPlayer(final Row row, final Battle battle, final PlayerResult player,
                                    final BattleContext ctx) {
        final long start = battle.startTime == null ? 0 : battle.startTime;
        if (start >= row.lastTime) {
            row.lastTime = start;
            row.nickname = StringUtils.hasText(player.nickname)
                    ? player.nickname : String.valueOf(player.accountId);
            row.clan = player.clan == null ? "" : player.clan;
        }

        final int team = safeTeam(player.team);
        final Integer winner = battle.winnerTeam;
        final boolean win = winner != null && winner != 0 && player.team == winner;
        final BattleAverageHp avg = ctx.averageHp();
        final int traded = TradeFacts.tradedDeaths(player, battle.players);
        final double impactValue = singleBattleImpact(player, ctx);

        // 原始权威数据（不依赖 HP）：始终累计
        row.battles++;
        if (win) {
            row.wins++;
        }
        row.kills += player.kills;
        row.damage += player.damageDealt;
        row.assistDamage += player.damageAssisted;
        row.potentialDamage += player.potentialDamage;
        row.potentialDamageSupplement += player.potentialDamageSupplement;
        row.impactSum += impactValue;
        row.impactBattles++;
        if (player.survived) {
            row.survivalBattles++;
        }
        if (!player.survived && traded > 0) {
            row.tradedDeaths++;
        }

        // 依赖 HP 的衍生指标：场均 HP UNKNOWN 时 fail-closed（不产生伪精确结果）
        if (!avg.complete()) {
            return;
        }
        final double averageHp = avg.value();
        final double contributionValue = roundContribution(player, averageHp);
        final double teamContribution = ctx.teamContribution[team];
        final double kastBattle = singleBattleKast(player, win, traded, averageHp);

        row.roundContribution += contributionValue;
        row.teamRoundContribution += teamContribution;
        row.averageHpSum += averageHp;
        row.averageHpBattles++;
        row.kastSum += kastBattle;
        row.kastBattles++;
        row.multiDamageEligible++;
        if (isMultiDamage(player, averageHp)) {
            row.multiDamageBattles++;
        }
    }

    private static double singleBattleImpact(final PlayerResult player, final BattleContext ctx) {
        final double battleDamageAssist = ctx.battleDamageAssist;
        final double damageAssistShare = battleDamageAssist == 0
                ? 0 : (player.damageDealt + player.damageAssisted) / battleDamageAssist;
        final double damageAssistIndex = damageAssistShare / EXPECTED_BATTLE_SHARE;
        return 100.0 * (0.75 * damageAssistIndex + 0.25 * player.kills);
    }

    private static double singleBattleKast(final PlayerResult player, final boolean win,
                                           final int traded, final double averageHp) {
        final double damageScore = ratio(player.damageDealt, averageHp * 1.15);
        final double assistScore = ratio(player.damageAssisted, averageHp * 1.25);
        final double survivalScore = player.survived && win ? 1.0 : 0.0;
        final double tradeScore = traded > 0 ? 1.0 : 0.0;
        final double combinedScore = ratio(player.damageDealt + player.damageAssisted, averageHp * 1.20);
        final double kastScore = Math.max(
                Math.max(damageScore, assistScore),
                Math.max(Math.max(survivalScore, tradeScore), combinedScore)
        );
        return cap(kastScore, 1.0);
    }

    private static boolean isMultiDamage(final PlayerResult player, final double averageHp) {
        // 场均 HP 未知（facts 层 fail-closed）时无法判定多伤，不得猜测。
        if (averageHp <= 0) {
            return false;
        }
        return player.damageDealt >= averageHp * 1.5
                || (player.damageDealt >= averageHp * 1.2 && player.kills >= 1)
                || (player.damageDealt >= averageHp && player.kills >= 2)
                || player.kills >= 3;
    }

    private static double roundContribution(final PlayerResult player, final double averageHp) {
        return player.damageDealt + player.damageAssisted + player.kills * averageHp / 7.0;
    }

    private static double ratio(final double numerator, final double denominator) {
        if (Double.isNaN(numerator) || Double.isInfinite(numerator) || numerator <= 0
                || Double.isNaN(denominator) || Double.isInfinite(denominator) || denominator <= 0) {
            return 0;
        }
        return numerator / denominator;
    }

    private static String percent(final double value) {
        if (Double.isNaN(value) || Double.isInfinite(value) || value <= 0) {
            return "0.00%";
        }
        return String.format(Locale.ROOT, "%.2f%%", value);
    }

    private static double cap(final double value, final double max) {
        if (Double.isNaN(value) || Double.isInfinite(value) || value <= 0) {
            return 0;
        }
        return Math.min(max, value);
    }

    private static int safeTeam(final int team) {
        return (team == 1 || team == 2) ? team : 0;
    }

    /** 单场战场级事实快照（HP 来自 BattleHpFacts；damageAssist/teamContribution 为纯聚合）。 */
    private static final class BattleContext {
        final double[] teamContribution = new double[3];
        double battleDamageAssist;
        BattleAverageHp battleAverageHp;

        static BattleContext of(final Battle battle) {
            final BattleContext ctx = new BattleContext();
            ctx.battleAverageHp = BattleHpFacts.averageHp(battle);
            for (final PlayerResult player : battle.players) {
                ctx.battleDamageAssist += player.damageDealt + player.damageAssisted;
            }
            if (ctx.battleAverageHp.complete()) {
                for (final PlayerResult player : battle.players) {
                    final int team = safeTeam(player.team);
                    ctx.teamContribution[team] += roundContribution(player, ctx.battleAverageHp.value());
                }
            }
            return ctx;
        }

        BattleAverageHp averageHp() {
            return battleAverageHp;
        }
    }
}

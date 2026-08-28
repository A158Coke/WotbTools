package com.wotb.core.stats;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Historical Rating V2 composite score, isolated from the current performance and League formulas.
 *
 * <p>This calculator deliberately consumes the already processed replay facts as read-only input. In
 * particular, potential damage is calculated locally instead of being written back to {@link PlayerResult},
 * so invoking the admin-only V2 gray page cannot alter Preview, Export, AI, or Playback data.</p>
 *
 * <p><b>STATIC_BASELINE (not replay actual-HP truth)</b>: the V2 composite's HP denominator is ALWAYS a static
 * tankopedia baseline — {@code tankopedia.info(tankId).maxHp()} when positive, otherwise
 * {@code STATIC_BASELINE_TANK_HP}. It is NEVER the replay's observed entry HP
 * ({@code PlayerResult.entryHpSource == EntryHpSource.OBSERVED_EXACT} / {@code PlayerResult.entryHp}) and must
 * never be presented as an observed HP fact. The single static-baseline formula must not switch denominator
 * semantics based on evidence coverage. §P0-6: the old alpha-damage potential-damage supplement driven by
 * {@code PlayerResult.killVictims} is removed because that field has no authoritative producer.</p>
 */
public final class RatingV2Calculator {

    private static final int STANDARD_BATTLE_PLAYER_COUNT = 14;
    private static final double EXPECTED_BATTLE_SHARE = 1.0 / STANDARD_BATTLE_PLAYER_COUNT;
    private static final double POTENTIAL_WEIGHT = 0.70;
    private static final double KAST_WEIGHT = 0.15;
    private static final double IMPACT_WEIGHT = 0.25;
    private static final double AST_WEIGHT = 0.30;
    private static final double MULTI_DAMAGE_WEIGHT = 0.10;
    private static final double KILLS_WEIGHT = 0.10;
    /** STATIC_BASELINE fallback HP for the historical gray-page V2 formula (NOT replay actual-HP). */
    private static final double STATIC_BASELINE_TANK_HP = 2400.0;

    private RatingV2Calculator() {
    }

    /** One player's historical V2 aggregate over the selected replay batch. */
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
        public int rating;
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

        private double kastSum;
        private double roundContribution;
        private double teamRoundContribution;
        private double impactSum;
        private double averageHpSum;
        private long lastTime = Long.MIN_VALUE;
        private int impactBattles;
        private int multiDamageBattles;

        public double winRate() {
            return battles == 0 ? 0 : 100.0 * wins / battles;
        }

        private void finish() {
            if (battles == 0) {
                return;
            }
            damageAvg = (double) damage / battles;
            assistAvg = (double) assistDamage / battles;
            potentialDamageAvg = (double) potentialDamage / battles;
            potentialDamageSupplementAvg = (double) potentialDamageSupplement / battles;
            killsAvg = (double) kills / battles;
            averageHp = averageHpSum / battles;
            kast = cap(100.0 * kastSum / battles, 100.0);
            contribution = teamRoundContribution == 0
                    ? 0 : 100.0 * roundContribution / teamRoundContribution;
            impactValue = impactBattles == 0 ? 0 : impactSum / impactBattles;
            impact = percent(impactValue);
            multiDamageRate = 100.0 * multiDamageBattles / battles;
            rating = finalRating();
        }

        private int finalRating() {
            final double hp = averageHp > 0 ? averageHp : 1;
            final double potentialIndex = cap(100.0 * potentialDamageAvg / hp, 250.0);
            final double astIndex = cap(100.0 * assistAvg / hp, 200.0);
            final double impactIndex = cap(impactValue, 250.0);
            final double killIndex = cap(100.0 * killsAvg, 250.0);
            final double weighted = POTENTIAL_WEIGHT * potentialIndex
                    + KAST_WEIGHT * cap(kast, 250.0)
                    + IMPACT_WEIGHT * impactIndex
                    + AST_WEIGHT * astIndex
                    + MULTI_DAMAGE_WEIGHT * multiDamageRate
                    + KILLS_WEIGHT * killIndex;
            return (int) Math.round(weighted * 10.0);
        }
    }

    /** Computes Rating V2 without mutating the supplied battles or player results. */
    public static List<Row> compute(final List<Battle> battles, final Tankopedia tankopedia) {
        if (battles == null || battles.isEmpty()) {
            return List.of();
        }
        final Map<Long, Row> rows = new LinkedHashMap<>();
        for (final Battle battle : battles) {
            final BattleContext context = BattleContext.of(battle, tankopedia);
            for (final PlayerResult player : battle.players) {
                final Row row = rows.computeIfAbsent(player.accountId, key -> {
                    final Row value = new Row();
                    value.accountId = key;
                    return value;
                });
                applyPlayer(row, battle, player, context, tankopedia);
            }
        }

        final List<Row> result = new ArrayList<>(rows.values());
        for (final Row row : result) {
            row.finish();
        }
        result.sort((first, second) -> Integer.compare(second.rating, first.rating));
        return result;
    }

    private static void applyPlayer(final Row row, final Battle battle, final PlayerResult player,
                                    final BattleContext context, final Tankopedia tankopedia) {
        final long start = battle.startTime == null ? 0 : battle.startTime;
        if (start >= row.lastTime) {
            row.lastTime = start;
            row.nickname = player.nickname != null && !player.nickname.isBlank()
                    ? player.nickname : String.valueOf(player.accountId);
            row.clan = player.clan == null ? "" : player.clan;
        }

        final int team = safeTeam(player.team);
        final Integer winner = battle.winnerTeam;
        final boolean win = winner != null && winner != 0 && player.team == winner;
        final double averageHp = context.averageHp();
        final double contributionValue = roundContribution(player, averageHp);
        final double teamContribution = context.teamContribution[team];
        final boolean traded = tradedDeath(player, battle.players);
        final double kastBattle = singleBattleKast(player, win, traded, averageHp);
        final double impactValue = singleBattleImpact(player, context);
        final PotentialDamage potential = potentialDamage(player);

        row.battles++;
        if (win) {
            row.wins++;
        }
        row.kills += player.kills;
        row.damage += player.damageDealt;
        row.assistDamage += player.damageAssisted;
        row.potentialDamage += potential.total();
        row.potentialDamageSupplement += potential.supplement();
        row.roundContribution += contributionValue;
        row.teamRoundContribution += teamContribution;
        row.impactSum += impactValue;
        row.impactBattles++;
        row.averageHpSum += averageHp;
        row.kastSum += kastBattle;
        if (isMultiDamage(player, averageHp)) {
            row.multiDamageBattles++;
        }
    }

    private static PotentialDamage potentialDamage(final PlayerResult player) {
        if (player.damageDealt < 0) {
            throw new IllegalArgumentException("actualDamage must be >= 0");
        }
        // §P0-6: the former alpha-damage supplement was driven by PlayerResult.killVictims, produced by a
        // damage-threshold heuristic with no authoritative producer (the parser no longer emits it). Remove
        // that stale input; potential damage is the observed damage only (no fabricated supplement).
        return new PotentialDamage(player.damageDealt, 0);
    }

    private static double singleBattleImpact(final PlayerResult player, final BattleContext context) {
        final double battleDamageAssist = context.battleDamageAssist;
        final double damageAssistShare = battleDamageAssist == 0
                ? 0 : (player.damageDealt + player.damageAssisted) / battleDamageAssist;
        final double damageAssistIndex = damageAssistShare / EXPECTED_BATTLE_SHARE;
        return 100.0 * (0.75 * damageAssistIndex + 0.25 * player.kills);
    }

    private static double singleBattleKast(final PlayerResult player, final boolean win,
                                           final boolean traded, final double averageHp) {
        final double damageScore = ratio(player.damageDealt, averageHp * 1.15);
        final double assistScore = ratio(player.damageAssisted, averageHp * 1.25);
        final double survivalScore = player.survived && win ? 1.0 : 0.0;
        final double tradeScore = traded ? 1.0 : 0.0;
        final double combinedScore = ratio(player.damageDealt + player.damageAssisted, averageHp * 1.20);
        return cap(Math.max(
                Math.max(damageScore, assistScore),
                Math.max(Math.max(survivalScore, tradeScore), combinedScore)
        ), 1.0);
    }

    private static boolean isMultiDamage(final PlayerResult player, final double averageHp) {
        return player.damageDealt >= averageHp * 1.5
                || (player.damageDealt >= averageHp * 1.2 && player.kills >= 1)
                || (player.damageDealt >= averageHp && player.kills >= 2)
                || player.kills >= 3;
    }

    private static double roundContribution(final PlayerResult player, final double averageHp) {
        return player.damageDealt + player.damageAssisted + player.kills * averageHp / 7.0;
    }

    /**
     * 互换击杀判定：使用 canonical {@link PlayerResultFormat#deathSec}（source-aware,
     * LIVE_EXACT &gt; SETTLEMENT_SECOND &gt; UNKNOWN）。UNKNOWN 的 residual survivalTimeSec 不得
     * 被当成 KNOWN 死亡时刻（P0-2 provenance）。窗口保持 V2 定义：双方死亡时刻差 ±5s。
     */
    private static boolean tradedDeath(final PlayerResult player, final List<PlayerResult> players) {
        if (player == null || player.survived) {
            return false;
        }
        final PlayerResultFormat.DeathTimeEvidence pEv = PlayerResultFormat.deathEvidence(player);
        if (pEv == null || !pEv.known()) {
            return false;
        }
        // PR147 §C precision-aware（V2 双向 ±5s 窗口）：SETTLEMENT_SECOND ±0.5s，不得用 midpoint。
        // 只有 <b>所有</b> 真实死亡时刻组合的差都在 ±5s 内（max(eMax-pMin, pMax-eMin) ≤ 5）才判定
        // traded；「有可能」但无法证明（ambiguous）→ fail-closed false。
        for (final PlayerResult other : players) {
            if (other == null || other.team == player.team || other.survived) {
                continue;
            }
            final PlayerResultFormat.DeathTimeEvidence oEv = PlayerResultFormat.deathEvidence(other);
            if (oEv == null || !oEv.known()) {
                continue;
            }
            final double worstGap = Math.max(oEv.upperBoundSec() - pEv.lowerBoundSec(),
                    pEv.upperBoundSec() - oEv.lowerBoundSec());
            if (worstGap <= 5.0 + 1e-9) {
                return true;
            }
        }
        return false;
    }

    /**
     * Static baseline for the historical V2 HP denominator: {@code tankopedia} maxHp when positive, else the
     * {@link #STATIC_BASELINE_TANK_HP} fallback. Never the replay's observed entry HP — the formula must not
     * switch denominator semantics based on evidence coverage (see class JavaDoc).
     */
    private static double estimatedHp(final PlayerResult player, final Tankopedia tankopedia) {
        final Integer maxHp = tankopedia.info(player.tankId).maxHp();
        return maxHp != null && maxHp > 0 ? maxHp : STATIC_BASELINE_TANK_HP;
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

    private record PotentialDamage(int total, int supplement) {
    }

    private static final class BattleContext {
        private final double[] teamContribution = new double[3];
        private double battleDamageAssist;
        private double battleAverageHp;

        private static BattleContext of(final Battle battle, final Tankopedia tankopedia) {
            final BattleContext context = new BattleContext();
            double totalHp = 0;
            for (final PlayerResult player : battle.players) {
                if (safeTeam(player.team) != 0) {
                    totalHp += estimatedHp(player, tankopedia);
                }
                context.battleDamageAssist += player.damageDealt + player.damageAssisted;
            }
            context.battleAverageHp = totalHp / STANDARD_BATTLE_PLAYER_COUNT;
            final double averageHp = context.averageHp();
            for (final PlayerResult player : battle.players) {
                context.teamContribution[safeTeam(player.team)] += roundContribution(player, averageHp);
            }
            return context;
        }

        private double averageHp() {
            return battleAverageHp > 0 ? battleAverageHp : STATIC_BASELINE_TANK_HP;
        }
    }
}

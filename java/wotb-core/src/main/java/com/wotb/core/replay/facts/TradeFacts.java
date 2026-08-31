package com.wotb.core.replay.facts;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.util.PlayerResultFormat;

import java.util.List;

/**
 * 互换击杀（trade）事实。
 *
 * <p>业务语义（V4.1 冻结）：玩家死亡后 {@code [0, +TRADE_AFTER_DEATH_WINDOW_SEC]} 秒内
 * （边界包含，directional）存在敌方死亡 → 视为 traded。死亡时刻统一通过
 * full-processing caller 使用 {@link PlayerResultFormat#deathSec(Battle, PlayerResult)} /
 * {@link PlayerResultFormat#deathEvidence(Battle, PlayerResult)} 消费 Battle 上的显式 observation；
 * settlement-only compatibility caller 使用单参数 overload。玩家存活或死亡时刻未知时 fail-closed
 * 返回 0，绝不直接读取/解释 {@link PlayerResult#survivalTimeSec}。</p>
 *
 * <p><b>precision-aware</b>：SETTLEMENT_SECOND 死亡时刻有 ±0.5s 量化，不得当作 exact point
 * 用于「谁先死 / 5s 窗口」。这里用 interval reasoning（fail-closed）：只有 <b>所有</b> 允许的真实死亡时刻
 * 组合都满足 trade 窗口（0 ≤ 敌方死亡 − 玩家死亡 ≤ 5）才计为 traded；「有可能」但无法证明一律不计入。</p>
 *
 * <p>注意：这是<b>死亡时刻窗口派生事实</b>，不是 killer attribution。回放 reconstruction
 * 的 killer 证据（{@code PlaybackCombatReconstruction.Destroyed}）并非所有对局都可靠。</p>
 */
public final class TradeFacts {

    /** 互换击杀时间窗口（秒）：玩家死亡后 {@code [0, +5]} 内存在敌方死亡（V4.1 directional，边界包含）。 */
    public static final double TRADE_AFTER_DEATH_WINDOW_SEC = 5.0;

    private TradeFacts() {
    }

    /**
     * 玩家死亡时刻 {@code [death, death + TRADE_AFTER_DEATH_WINDOW_SEC]}s 窗口内
     * （敌方死亡不早于玩家、至多晚 5s，边界包含）的敌方死亡数（≥0）。
     * 敌方在玩家死亡前（或窗口后）阵亡不计入；precision interval 无法证明满足 → fail-closed 不计入。
     *
     * @param player  目标玩家
     * @param players 同场全部玩家（含目标）
     * @return 窗口内<a>确定性</a>满足的敌方死亡数；存活 / canonical 死亡时刻 UNKNOWN → 0
     */
    public static int tradedDeaths(final PlayerResult player, final List<PlayerResult> players) {
        return tradedDeaths(null, player, players);
    }

    /** Full-processing overload that reads live observations from the Battle boundary. */
    public static int tradedDeaths(final Battle battle, final PlayerResult player,
                                   final List<PlayerResult> players) {
        if (player == null || player.survived || players == null || players.isEmpty()) {
            return 0;
        }
        final PlayerResultFormat.DeathTimeEvidence playerEv = evidenceFor(battle, player);
        if (playerEv == null || !playerEv.known()) {
            return 0;
        }
        int enemyDeaths = 0;
        final double pMin = playerEv.lowerBoundSec();
        final double pMax = playerEv.upperBoundSec();
        for (final PlayerResult other : players) {
            if (other == null || other.team == player.team || other.survived) {
                continue;
            }
            final PlayerResultFormat.DeathTimeEvidence otherEv = evidenceFor(battle, other);
            if (otherEv == null || !otherEv.known()) {
                continue;
            }
            // interval reasoning (fail-closed): trade window = [player death,
            // player death + TRADE_AFTER_DEATH_WINDOW_SEC], enemy death not before player's.
            // "Definitely traded" requires EVERY real death-time pair (within the quantization
            // intervals) to satisfy 0 <= enemyDeath - playerDeath <= window. "Could be" (ambiguous)
            // returns false — never use midpoints to force a trade.
            final double eMax = otherEv.upperBoundSec();
            final double eMin = otherEv.lowerBoundSec();
            final boolean definitelyTraded =
                    (eMax - pMin) <= TRADE_AFTER_DEATH_WINDOW_SEC + 1e-9
                            && (eMin - pMax) >= -1e-9;
            if (definitelyTraded) {
                enemyDeaths++;
            }
        }
        return Math.max(0, enemyDeaths);
    }

    /**
     * Full processing prefers an explicitly supplied live observation.  A battle without an
     * observation still has its settlement death fact; retain that quantized interval as the
     * compatibility fallback.  An explicit UNKNOWN observation remains fail-closed.
     */
    private static PlayerResultFormat.DeathTimeEvidence evidenceFor(
            final Battle battle, final PlayerResult player) {
        if (battle == null || battle.liveDeathObservations == null
                || !battle.liveDeathObservations.containsKey(player.accountId)) {
            return PlayerResultFormat.deathEvidence(player);
        }
        return PlayerResultFormat.deathEvidence(battle, player);
    }
}

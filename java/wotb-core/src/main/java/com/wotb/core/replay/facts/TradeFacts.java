package com.wotb.core.replay.facts;

import com.wotb.core.model.PlayerResult;
import com.wotb.core.util.PlayerResultFormat;

import java.util.List;

/**
 * 互换击杀（trade）事实。
 *
 * <p>业务语义（V4.1 冻结）：玩家死亡后 {@code [0, +TRADE_AFTER_DEATH_WINDOW_SEC]} 秒内
 * （边界包含，directional）存在敌方死亡 → 视为 traded。死亡时刻统一通过
 * {@link PlayerResultFormat#deathSec(PlayerResult)} 消费 canonical authority
 * （LIVE_EXACT > SETTLEMENT_SECOND > UNKNOWN）；玩家存活或死亡时刻未知时 fail-closed 返回 0，
 * 绝不直接读取/解释 {@link PlayerResult#survivalTimeSec}。</p>
 *
 * <p>注意：这是<b>死亡时刻窗口派生事实</b>，不是 killer attribution。回放 reconstruction
 * 的 killer 证据（{@code PlaybackCombatReconstruction.Destroyed}）并非所有对局都可靠，
 * 后续如需 killer 级 trade 语义应在事实层扩展，而不是在 metrics 层重推。</p>
 */
public final class TradeFacts {

    /** 互换击杀时间窗口（秒）：玩家死亡后 {@code [0, +5]} 内存在敌方死亡（V4.1 directional，边界包含）。 */
    public static final double TRADE_AFTER_DEATH_WINDOW_SEC = 5.0;

    private TradeFacts() {
    }

    /**
     * 玩家死亡时刻 {@code [death, death + TRADE_AFTER_DEATH_WINDOW_SEC]}s 窗口内
     * （敌方死亡不早于玩家、至多晚 5s，边界包含）的敌方死亡数（≥0）。
     * 敌方在玩家死亡前阵亡不计入 trade。
     *
     * @param player  目标玩家
     * @param players 同场全部玩家（含目标）
     * @return 窗口内敌方死亡数；存活 / canonical 死亡时刻 UNKNOWN → 0
     */
    public static int tradedDeaths(final PlayerResult player, final List<PlayerResult> players) {
        if (player == null || player.survived || players == null || players.isEmpty()) {
            return 0;
        }
        final double deathSec = PlayerResultFormat.deathSec(player);
        if (!(deathSec > 0)) {
            return 0;
        }
        int enemyDeaths = 0;
        final double from = deathSec;
        final double to = deathSec + TRADE_AFTER_DEATH_WINDOW_SEC;
        for (final PlayerResult other : players) {
            if (other == null || other.team == player.team || other.survived) {
                continue;
            }
            final double otherDeathSec = PlayerResultFormat.deathSec(other);
            if (otherDeathSec > 0 && otherDeathSec >= from && otherDeathSec <= to) {
                enemyDeaths++;
            }
        }
        return Math.max(0, enemyDeaths);
    }
}

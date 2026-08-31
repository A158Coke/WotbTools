package com.wotb.core.replay.facts;

import com.wotb.core.model.PlayerResult;
import com.wotb.core.util.PlayerResultFormat;

import java.util.List;

/**
 * 互换击杀（trade）事实。
 *
 * <p>业务语义（V4.1 冻结）：玩家死亡后 {@code [0, +TRADE_AFTER_DEATH_WINDOW_SEC]} 秒内
 * （边界包含，directional）存在敌方死亡 → 视为 traded。双方死亡秒均直接使用 settlement
 * lifeTime；live reconstruction 不参与 League/Trade 业务判定。</p>
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
     * 敌方在玩家死亡前（或窗口后）阵亡不计入。
     *
     * @param player  目标玩家
     * @param players 同场全部玩家（含目标）
     * @return 窗口内满足的敌方死亡数；存活 / settlement 死亡秒非法 → 0
     */
    public static int tradedDeaths(final PlayerResult player, final List<PlayerResult> players) {
        if (player == null || player.survived || players == null || players.isEmpty()) {
            return 0;
        }
        final double playerDeathSec = PlayerResultFormat.deathSec(player);
        if (playerDeathSec <= 0) {
            return 0;
        }
        int enemyDeaths = 0;
        for (final PlayerResult other : players) {
            if (other == null || other.team == player.team || other.survived) {
                continue;
            }
            final double enemyDeathSec = PlayerResultFormat.deathSec(other);
            if (enemyDeathSec <= 0) {
                continue;
            }
            final double delta = enemyDeathSec - playerDeathSec;
            if (delta >= 0 && delta <= TRADE_AFTER_DEATH_WINDOW_SEC) {
                enemyDeaths++;
            }
        }
        return Math.max(0, enemyDeaths);
    }
}

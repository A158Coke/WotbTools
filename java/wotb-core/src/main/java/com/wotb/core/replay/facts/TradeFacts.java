package com.wotb.core.replay.facts;

import com.wotb.core.model.PlayerResult;

import java.util.List;

/**
 * 互换击杀（trade）事实。
 *
 * <p>业务语义（保持原 Rating V2 的既有窗口规则，仅把推导从 metrics 层迁移到事实层）：
 * 玩家死亡后 ±{@value #TRADE_WINDOW_SEC} 秒内存在敌方死亡 → 视为 traded。依赖
 * {@link com.wotb.core.processing.DeathTimeReconciler} 校准后的权威
 * {@link PlayerResult#survivalTimeSec}；玩家存活或死亡时刻未知时 fail-closed 返回 0，
 * 绝不猜测。</p>
 *
 * <p>注意：这是<b>死亡时刻窗口启发式</b>，不是 killer attribution。回放 reconstruction
 * 的 killer 证据（{@code PlaybackCombatReconstruction.Destroyed}）并非所有对局都可靠，
 * 后续如需 killer 级 trade 语义应在事实层扩展，而不是在 metrics 层重推。</p>
 */
public final class TradeFacts {

    /** 互换击杀时间窗口（秒）：玩家死亡 ± 窗口内存在敌方死亡。 */
    public static final double TRADE_WINDOW_SEC = 5.0;

    private TradeFacts() {
    }

    /**
     * 玩家死亡时刻 ±{@value #TRADE_WINDOW_SEC}s 窗口内的敌方死亡数（≥0）。
     *
     * @param player  目标玩家
     * @param players 同场全部玩家（含目标）
     * @return 窗口内敌方死亡数；存活 / 死亡时刻未知 → 0
     */
    public static int tradedDeaths(final PlayerResult player, final List<PlayerResult> players) {
        if (player.survived || player.survivalTimeSec <= 0) {
            return 0;
        }
        int enemyDeaths = 0;
        final double from = player.survivalTimeSec - TRADE_WINDOW_SEC;
        final double to = player.survivalTimeSec + TRADE_WINDOW_SEC;
        for (final PlayerResult other : players) {
            if (other.team == player.team || other.survived || other.survivalTimeSec <= 0) {
                continue;
            }
            if (other.survivalTimeSec >= from && other.survivalTimeSec <= to) {
                enemyDeaths++;
            }
        }
        return Math.max(0, enemyDeaths);
    }
}

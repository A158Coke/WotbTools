package com.wotb.core.replay.facts;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.evidence.ObservedMaxHp;

/**
 * 战场级 HP 事实（唯一权威口径，供所有 replay consumer 共用）。
 *
 * <p>场均进场满血量 = 参战玩家「已证明进场满血（OBSERVED_EXACT）或 tankopedia base
 * （BASE_FALLBACK baseline）」之和 ÷ 标准参战人数。</p>
 *
 * <p><b>Provenance 语义（fail-closed）</b>：标准 14 人战斗中存在需要计入平均值的玩家
 * （队伍 1/2）HP fact 为 UNKNOWN 时，场均 HP 返回 {@link BattleAverageHp#complete()}
 * = false（unavailable）——<b>禁止把 UNKNOWN 按 0 HP 偷偷参与均值</b>。只有全部参战玩家
 * HP 已知时才返回 complete=true 的权威均值。与 Battle Playback / AI Review 共用
 * {@link ObservedMaxHp#fullMaxHp} 的 provenance 口径，保证全站只有一个 authoritative
 * battle HP source。</p>
 */
public final class BattleHpFacts {

    /** 标准随机战参战人数（场均血量分母，业务口径固定）。 */
    public static final int STANDARD_BATTLE_PLAYER_COUNT = 14;

    /**
     * 场均进场满血量的 provenance-aware 结果。
     *
     * @param value    场均 HP；仅 {@link #complete()} 为 true 时有效，否则为 0（unavailable）
     * @param complete true = 全部参战玩家 HP 已知的权威均值；false = 存在 UNKNOWN，unavailable
     */
    public record BattleAverageHp(double value, boolean complete) {

        /** 存在 UNKNOWN / 无数据时的 unavailable 结果（value 无效）。 */
        public static final BattleAverageHp UNKNOWN = new BattleAverageHp(0, false);
    }

    private BattleHpFacts() {
    }

    /**
     * 本局平均进场满血量（provenance-aware，fail-closed）。
     *
     * @return {@link BattleAverageHp#complete()}=true 时 value 为权威均值；
     *         存在任何参战玩家 HP UNKNOWN（或无参战玩家）时 complete=false（unavailable）
     */
    public static BattleAverageHp averageHp(final Battle battle) {
        if (battle == null || battle.players == null) {
            return BattleAverageHp.UNKNOWN;
        }
        double total = 0;
        for (final PlayerResult player : battle.players) {
            if (player == null || (player.team != 1 && player.team != 2)) {
                continue;
            }
            final Integer hp = ObservedMaxHp.fullMaxHp(player);
            if (hp == null || hp <= 0) {
                // 需要计入平均值的玩家 HP UNKNOWN → 整场均值 unavailable（禁止 0 参与）
                return BattleAverageHp.UNKNOWN;
            }
            total += hp;
        }
        return new BattleAverageHp(total / STANDARD_BATTLE_PLAYER_COUNT, true);
    }
}

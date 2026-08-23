package com.wotb.core.replay.facts;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.evidence.ObservedMaxHp;

/**
 * 战场级 HP 事实（唯一权威口径，供所有 replay consumer 共用）。
 *
 * <p>场均进场满血量 = 参战玩家「已证明进场满血（OBSERVED_EXACT）或 tankopedia base
 * （BASE_FALLBACK baseline）」之和 ÷ 标准参战人数。HP 完全未知（UNKNOWN）的玩家贡献 0——
 * <b>绝不使用硬编码兜底血量冒充权威</b>（历史 Rating V2 曾固定 2400，本类禁止）。</p>
 *
 * <p>与 Battle Playback / AI Review 共用 {@link ObservedMaxHp#fullMaxHp} 的 provenance
 * 口径，保证全站只有一个 authoritative battle HP source。</p>
 */
public final class BattleHpFacts {

    /** 标准随机战参战人数（场均血量分母，业务口径固定）。 */
    public static final int STANDARD_BATTLE_PLAYER_COUNT = 14;

    private BattleHpFacts() {
    }

    /**
     * 本局平均进场满血量（provenance-aware，fail-closed）。
     *
     * @return 已知 HP 的均值；无任何已知 HP 时为 0（调用方按 unknown 处理，禁止回填猜测值）
     */
    public static double averageHp(final Battle battle) {
        if (battle == null || battle.players == null) {
            return 0;
        }
        double total = 0;
        for (final PlayerResult player : battle.players) {
            if (player == null || (player.team != 1 && player.team != 2)) {
                continue;
            }
            final Integer hp = ObservedMaxHp.fullMaxHp(player);
            if (hp != null && hp > 0) {
                total += hp;
            }
        }
        return total / STANDARD_BATTLE_PLAYER_COUNT;
    }
}

package com.wotb.web.hof.policy;

import java.util.Optional;

/**
 * 名人堂战斗模式策略（集中、单一事实源）：raw meta.json#arenaBonusType → RANDOM / RATING / UNSUPPORTED。
 * 禁止把 {@code arenaBonusType == 1} 之类的判断散落在 Service / Controller / tests。
 * <p>证据矩阵（见 docs/features/hall-of-fame.md）：</p>
 * <ul>
 *   <li>1 = RANDOM —— 本项目真实回放证据（random-battle-example 等，meta.json arenaBonusType=1 实解）
 *       + 外部 Jylpah/blitz-tools 映射一致 → 支持</li>
 *   <li>7 = RATING —— established external WoT Blitz replay tooling 证据
 *       （Jylpah/blitz-tools analyze_wotb_replays.py BattleCategorizationList._battle_modes，
 *       "Rating": 7，无不确定性注释；与 1/2/4/8 真实样本映射一致）→ 支持。
 *       仓内暂无真实 Rating 回放 fixture（fixture gap，见文档）；未来补 parser→RATING→upload 真实集成验证。</li>
 *   <li>2 = TRAINING（本项目真实夹具）→ 不支持</li>
 *   <li>4 = TOURNAMENT supremacy（本项目真实样本）→ 不支持</li>
 *   <li>8 = MAD GAMES（外部映射）→ 不支持</li>
 * </ul>
 */
public final class HallOfFameBattleTypePolicy {

    private HallOfFameBattleTypePolicy() {
    }

    /**
     * raw → 归一模式；未知/null/不支持 → empty。
     */
    public static Optional<HallOfFameBattleType> resolve(final Integer arenaBonusType) {
        return HallOfFameBattleType.resolve(arenaBonusType);
    }

    /**
     * 是否受支持（RANDOM / RATING）。
     */
    public static boolean isSupported(final Integer arenaBonusType) {
        return resolve(arenaBonusType).isPresent();
    }
}

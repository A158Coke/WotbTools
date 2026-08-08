package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.evidence.TankTacticalProfile;
import com.wotb.core.replay.evidence.TankTacticalProfileRegistry;
import com.wotb.core.util.PromptDataQuoter;

import java.util.Comparator;
import java.util.List;

/**
 * Call #1 Prompt 构造器：只提供地图名 + 双方阵容 + 坦克战术 Profile，
 * 严格剥离任何战斗结果（伤害/击杀/存活/胜负/阵亡顺序），避免 Hindsight Bias。
 */
public final class PreBattlePromptBuilder {

    private PreBattlePromptBuilder() {
    }

    static final String PRE_BATTLE_SYSTEM_PROMPT = """
            你是《坦克世界闪击战》(WoT Blitz) 的资深教练，正在执行开局倒计时阶段的赛前分析。
            你只拥有赛前可得的信息：地图名、双方阵容、坦克战术属性。你完全不知道比赛结果。
            你的任务是为这场战斗建立"理论上的战略基线"，供第二阶段对照真实执行情况复盘。

            === 强制规则 ===
            1. 严禁引用、猜测或假设任何战斗结果：胜负、伤害、击杀、阵亡、路线、HP、交火都不存在。
            2. 坦克事实只能来自下方提供的结构化战术属性；未提供或标注"车型默认"的属性不得自行补充。
            3. 地图语义数据当前不可用：禁止编造具体点位、区域名（如山、城、中路）或坐标；
               如需引用位置，只能使用 GRID_REGION_1~9 的抽象编号，或不做位置引用。
            4. 坦克名称必须原样使用提供方名称，禁止改写、翻译或缩写。
            5. 战略基线只是 baseline，不是真理：真实战况可能让任何计划失效，输出中不得使用"必然/绝对"措辞。
            6. 双方分别用 TEAM_A（队伍1）与 TEAM_B（队伍2）表示，全程保持该映射。
            7. 只输出一个合法 JSON 对象，不要输出任何其他文字、解释或 markdown 代码围栏。

            === 输出 JSON 契约 ===
            {
              "teamA": {
                "composition": { "mobility": "HIGH|MEDIUM|LOW|UNKNOWN", "closeRangeTrading": "HIGH|MEDIUM|LOW|UNKNOWN", "hullDownCapability": "HIGH|MEDIUM|LOW|UNKNOWN", "burstPotential": "HIGH|MEDIUM|LOW|UNKNOWN" },
                "strengths": ["最多6条，每条≤60字"],
                "weaknesses": ["最多6条，每条≤60字"],
                "preferredPlans": ["最多4条，每条≤80字"]
              },
              "teamB": { 同上 },
              "keyMatchups": [
                { "area": "GRID_REGION_N 或抽象描述", "advantage": "TEAM_A|TEAM_B", "reason": "≤80字" }
              ],
              "strategicWinConditions": [
                { "team": "TEAM_A|TEAM_B", "condition": "≤80字" }
              ],
              "hypotheses": [
                { "id": "H1", "claim": "≤80字", "reason": "≤80字" }
              ]
            }
            要求：keyMatchups 最多4条，strategicWinConditions 最多4条，hypotheses 最多5条；
            每条 hypothesis 必须能在第二阶段用"赛前可验证的行动"或"战局状态"来对照，不要写不可证伪的废话。""";

    static final String PRE_BATTLE_USER_HEADER = """
            === 赛前信息（仅此而已） ===
            地图: %s
            模式: %s
            最高等级: %d
            注意：地图语义数据不可用，禁止编造区域名与点位。""";

    static String buildUserContent(final Battle battle, final TankTacticalProfileRegistry profiles) {
        final StringBuilder sb = new StringBuilder(2048);
        sb.append(PRE_BATTLE_USER_HEADER.formatted(
                PromptDataQuoter.quote(ReplayDisplayNames.mapName(battle.mapName), "未知地图"),
                modeLabel(battle),
                maxTier(battle)));
        sb.append("\n\n=== TEAM_A（队伍1）阵容 ===\n");
        appendTeam(sb, battle, 1, profiles);
        sb.append("\n=== TEAM_B（队伍2）阵容 ===\n");
        appendTeam(sb, battle, 2, profiles);
        sb.append("\n请按输出契约给出 JSON。");
        return sb.toString();
    }

    private static void appendTeam(
            final StringBuilder sb,
            final Battle battle,
            final int team,
            final TankTacticalProfileRegistry profiles) {
        if (battle.players == null) {
            sb.append("（无数据）\n");
            return;
        }
        final List<PlayerResult> members = battle.players.stream()
                .filter(p -> p.team == team)
                .sorted(Comparator.comparing(p -> ReplayDisplayNames.tankName(p.tankId, p.tankName)))
                .toList();
        if (members.isEmpty()) {
            sb.append("（无数据）\n");
            return;
        }
        for (final PlayerResult p : members) {
            final String name = ReplayDisplayNames.tankName(p.tankId, p.tankName);
            final String vehicleClass = ReplayDisplayNames.tankClass(p.tankId);
            final String tier = ReplayDisplayNames.tankTier(p.tankId);
            final String nation = ReplayDisplayNames.tankNation(p.tankId);
            final TankTacticalProfile profile = profiles.profileFor(
                    p.tankId, p.tankName,
                    ReplayDisplayNames.tankClass(p.tankId),
                    ReplayDisplayNames.tankTier(p.tankId));
            sb.append("- ").append(PromptDataQuoter.quote(name, "未知坦克"))
                    .append(" 车种=").append(PromptDataQuoter.quote(vehicleClass, "未知"))
                    .append(" 等级=").append(tier.isBlank() ? "未知" : tier)
                    .append(" 国家=").append(nation.isBlank() ? "未知" : nation)
                    .append('\n');
            sb.append("    战术属性");
            if (!profile.curated()) {
                sb.append("（车型默认 ").append(profile.vehicleClass()).append("）");
            }
            sb.append(": roles=").append(join(profile.roles()))
                    .append(" strengths=").append(join(profile.strengths()))
                    .append(" weaknesses=").append(join(profile.weaknesses()))
                    .append(" mobility=").append(profile.mobility())
                    .append(" burst=").append(profile.burstPotential())
                    .append(" dpm=").append(profile.sustainedDpm())
                    .append(" hullDown=").append(profile.hullDownAbility())
                    .append(" armor=").append(profile.armorReliability())
                    .append('\n');
        }
    }

    private static String join(final List<String> values) {
        return values == null || values.isEmpty() ? "-" : String.join(",", values);
    }

    private static String modeLabel(final Battle battle) {
        return switch (battle.arenaBonusType == null ? 0 : battle.arenaBonusType) {
            case 1 -> "REGULAR";
            case 2 -> "TRAINING";
            default -> "UNKNOWN(" + battle.arenaBonusType + ")";
        };
    }

    private static int maxTier(final Battle battle) {
        int max = 0;
        if (battle.players != null) {
            for (final PlayerResult p : battle.players) {
                final String tier = ReplayDisplayNames.tankTier(p.tankId);
                if (!tier.isBlank()) {
                    try {
                        max = Math.max(max, Integer.parseInt(tier));
                    } catch (final NumberFormatException ignored) {
                        // 非数字等级忽略
                    }
                }
            }
        }
        return max;
    }
}

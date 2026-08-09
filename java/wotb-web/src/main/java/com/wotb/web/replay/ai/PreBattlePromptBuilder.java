package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.evidence.TankTacticalProfile;
import com.wotb.core.replay.evidence.TankTacticalProfileRegistry;
import com.wotb.core.replay.map.MapTacticalSemantics;
import com.wotb.core.util.PromptDataQuoter;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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
            1. 严禁引用、猜测或假设任何战斗结果：胜负、伤害、击杀、阵亡、路线、交火都不存在。
               车辆基础血量（tankopedia maxHp）与双方总血量为赛前车辆属性，允许用于血池/换血能力判断；
               禁止推断战斗中的实际血量变化或承伤。
            2. 坦克事实只能来自下方提供的结构化战术属性；未提供或标注"车型默认"的属性不得自行补充。
            3. 地图战术语义只使用下方提供的数据（AREA 名称/类型/特征/适合/风险/关系/出生点语义/置信度）；
               可信度必须按下方的可信度图例理解：EXACT_CLIENT_DATA/EXACT_SCENE_DATA 是客户端直接事实；
               NAME_HEURISTIC 表示对象位置精确但建筑/植被/铁路等类别由资源名推断；
               GRID_RULE_DERIVED 表示区域名称、区域边界与区域合并结果只是确定性规则候选；
               RULE_DERIVED_CANDIDATE 表示 favors/risks 只是战术假设候选，只能作为假设依据；
               verified=false 表示尚未完成人工地图核验，不得把区域候选描述为已验证事实；
               ADJACENT_TO 只表示确定性分析网格相邻：不代表存在可通行路线、不代表具备视线、
               不代表能够建立交叉火力，不得据此声称 CONTROLS 或 ENABLES_PRESSURE_AGAINST；
               地图无语义数据时，区域一律 UNKNOWN，禁止编造具体点位、区域名或坐标；
               出生点语义未提供时输出 UNKNOWN；
               禁止声称 CONTROLS / ENABLES_PRESSURE_AGAINST / 交叉火力 / 视线 / 通行路线等未提供的关系；
               GRID_REGION_1~9 与下方 AREA 标注的九宫格编号一致（按客户端数据推导）；
               无语义数据时 GRID_REGION_1~9 仍只是位置编号，不是战术区域名。
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
                "preferredPlans": ["最多4条，每条≤80字，必须分阶段给出：开局（前30秒站位/分路）、中期（主攻方向/集火目标/侧翼）、残局（血量/人数优势利用），每条以【开局】【中期】【残局】开头"]
              },
              "teamB": { 同上 },
              "keyMatchups": [
                { "area": "地图语义中的 AREA 名（如 AREA_A）或 GRID_REGION_N；无语义时用抽象描述", "advantage": "TEAM_A|TEAM_B", "reason": "≤80字" }
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
            注意：地图战术语义见下方；未提供则为 UNKNOWN，禁止编造区域名与点位。""";

    static final String CONFIDENCE_LEGEND = """
            === 可信度图例 ===
            - EXACT_CLIENT_DATA / EXACT_SCENE_DATA: 客户端直接事实（坐标/高程/出生点/占领点）
            - NAME_HEURISTIC: 对象位置精确；建筑/植被/铁路等类别由资源名推断
            - GRID_RULE_DERIVED: 区域名称、区域边界与区域合并结果是确定性规则候选
            - RULE_DERIVED_CANDIDATE: favors/risks 只是战术假设候选
            """;

    static String buildUserContent(final Battle battle,
                                   final TankTacticalProfileRegistry profiles,
                                   final MapTacticalSemantics mapSemantics) {
        final StringBuilder sb = new StringBuilder(3072);
        sb.append(PRE_BATTLE_USER_HEADER.formatted(
                PromptDataQuoter.quote(ReplayDisplayNames.mapName(battle.mapName), "未知地图"),
                modeLabel(battle),
                maxTier(battle)));
        sb.append('\n').append(buildMapSemanticsSection(battle.mapName, mapSemantics));
        sb.append("\n\n=== TEAM_A（队伍1）阵容 ===\n");
        appendTeam(sb, battle, 1, profiles);
        sb.append("\n=== TEAM_B（队伍2）阵容 ===\n");
        appendTeam(sb, battle, 2, profiles);
        sb.append("\n=== 双方总血量（tankopedia maxHp 求和，基础值不含装备） ===\n");
        sb.append("TEAM_A 总血量=").append(totalHp(battle, 1)).append('\n');
        sb.append("TEAM_B 总血量=").append(totalHp(battle, 2)).append('\n');
        sb.append("\n请按输出契约给出 JSON。");
        return sb.toString();
    }

    /** 渲染地图战术语义段；无语义数据时明确 UNKNOWN，禁止编造。 */
    static String buildMapSemanticsSection(final String mapCode,
                                           final MapTacticalSemantics mapSemantics) {
        final StringBuilder sb = new StringBuilder(3072);
        sb.append("=== 地图战术语义 ===\n");
        if (mapSemantics == null || !mapSemantics.hasSemantics()) {
            sb.append("地图 code: ").append(PromptDataQuoter.quote(mapCode, "未知")).append('\n');
            sb.append("战术语义: UNKNOWN（该地图暂无语义数据，禁止编造区域名与点位）\n");
            return sb.toString();
        }
        final String displayName = mapSemantics.displayName().isBlank()
                ? mapCode : mapSemantics.displayName();
        sb.append("地图: ").append(PromptDataQuoter.quote(displayName, mapCode))
                .append("（内部 code: ").append(PromptDataQuoter.quote(mapCode, "未知"))
                .append("）\n");
        sb.append("数据来源: ")
                .append(mapSemantics.source().isBlank()
                        ? "Wot Blitz 客户端 SC2 + heightmap（CLIENT_RESOURCE_DERIVED）"
                        : mapSemantics.source())
                .append("（客户端资源解码，非 LLM 猜测）\n");
        sb.append("人工地图核验: ")
                .append(mapSemantics.verified()
                        ? "已完成"
                        : "未完成（verified=false，区域名称/类型/边界/favors/risks 未经人工确认）")
                .append('\n');
        sb.append(CONFIDENCE_LEGEND);
        final Map<String, String> dominantConfidence = dominantConfidence(mapSemantics.areas());
        if (!dominantConfidence.isEmpty()) {
            sb.append("本图区域置信度（与下方可信度图例对应）: ");
            sb.append(String.join("；", dominantConfidence.values()));
            sb.append('\n');
        }
        sb.append("区域:\n");
        mapSemantics.areas().forEach((id, area) -> {
            sb.append("- ").append(id);
            if (!area.label().isBlank()) {
                sb.append(" [").append(area.label()).append(']');
            }
            if (!area.types().isEmpty()) {
                sb.append(" 类型=").append(String.join(",", area.types()));
            }
            if (!area.gridRegions().isEmpty()) {
                sb.append(" 九宫格=").append(String.join(",", area.gridRegions()));
            }
            sb.append('\n');
            if (!area.characteristics().isEmpty()) {
                sb.append("    特征: ").append(String.join("; ", area.characteristics())).append('\n');
            }
            if (!area.favors().isEmpty()) {
                sb.append("    适合(规则候选): ").append(String.join(", ", area.favors())).append('\n');
            }
            if (!area.risks().isEmpty()) {
                sb.append("    风险(规则候选): ").append(String.join("; ", area.risks())).append('\n');
            }
            appendConfidenceDiff(sb, area, dominantConfidence);
        });
        if (!mapSemantics.relationships().isEmpty()) {
            sb.append("区域关系（原始语义；ADJACENT_TO 仅表示确定性分析网格相邻，");
            sb.append("不代表可通行路线/视线/交叉火力）:\n");
            mapSemantics.relationships().forEach(rel -> {
                sb.append("- ").append(rel.from()).append(' ').append(rel.type())
                        .append(' ').append(rel.to()).append('\n');
                if (!rel.reason().isBlank()) {
                    sb.append("    reason=").append(rel.reason()).append('\n');
                }
                if (!rel.confidence().isBlank()) {
                    sb.append("    confidence=").append(rel.confidence()).append('\n');
                }
            });
        }
        if (!mapSemantics.spawnSemantics().isEmpty()) {
            sb.append("出生点语义:\n");
            mapSemantics.spawnSemantics().forEach((team, spawn) -> {
                sb.append("- ").append(teamLabel(team)).append(": ");
                if (spawn.status().equalsIgnoreCase("UNKNOWN") || spawn.areas().isEmpty()) {
                    sb.append("UNKNOWN（出生点无法可靠确定）\n");
                } else {
                    sb.append(spawn.spawnCount()).append(" 个出生点，区域 ")
                            .append(String.join(", ", spawn.areas()))
                            .append("（状态 ").append(spawn.status()).append("）\n");
                }
            });
        } else {
            sb.append("出生点语义: UNKNOWN（当前无法可靠确定）\n");
        }
        sb.append("置信度边界: favors/risks 是 RULE_DERIVED_CANDIDATE（规则候选），");
        sb.append("不是已验证结论；CONTROLS / ENABLES_PRESSURE_AGAINST / 交叉火力 / ");
        sb.append("视线 / 通行路线未提供，禁止声称。\n");
        return sb.toString();
    }

    /** 聚合各区域置信度字段的众数，供全局一行展示（避免逐区域重复）。 */
    private static Map<String, String> dominantConfidence(
            final Map<String, MapTacticalSemantics.TacticalArea> areas) {
        final String[] fields = {
                "geometry", "objectPositions", "objectCategories",
                "areaBoundary", "favorsAndRisks"
        };
        final Map<String, Map<String, Integer>> counts = new LinkedHashMap<>();
        final Map<String, String> dominant = new LinkedHashMap<>();
        for (final MapTacticalSemantics.TacticalArea area : areas.values()) {
            final MapTacticalSemantics.AreaConfidence c = area.confidence();
            final String[] values = {
                    c.geometry(), c.objectPositions(), c.objectCategories(),
                    c.areaBoundary(), c.favorsAndRisks()
            };
            for (int i = 0; i < fields.length; i++) {
                if (values[i].isBlank()) {
                    continue;
                }
                counts.computeIfAbsent(fields[i], k -> new LinkedHashMap<>())
                        .merge(values[i], 1, Integer::sum);
            }
        }
        for (final String field : fields) {
            final Map<String, Integer> perField = counts.get(field);
            if (perField == null || perField.isEmpty()) {
                continue;
            }
            final String top = perField.entrySet().stream()
                    // Map.copyOf 不保证迭代顺序，并列众数必须 tie-break 保持确定性
                    .max(Map.Entry.<String, Integer>comparingByValue()
                            .thenComparing(Map.Entry.comparingByKey()))
                    .map(Map.Entry::getKey)
                    .orElse("");
            dominant.put(field, field + "=" + top);
        }
        return dominant;
    }

    /** 仅标注与该图全局置信度不一致的区域字段，避免 30+ 区域逐行重复。 */
    private static void appendConfidenceDiff(
            final StringBuilder sb,
            final MapTacticalSemantics.TacticalArea area,
            final Map<String, String> dominant) {
        final MapTacticalSemantics.AreaConfidence c = area.confidence();
        final Map<String, String> expected = new LinkedHashMap<>();
        expected.put("geometry", c.geometry());
        expected.put("objectPositions", c.objectPositions());
        expected.put("objectCategories", c.objectCategories());
        expected.put("areaBoundary", c.areaBoundary());
        expected.put("favorsAndRisks", c.favorsAndRisks());
        final List<String> diffs = new ArrayList<>();
        expected.forEach((field, value) -> {
            if (value.isBlank()) {
                return;
            }
            final String dominantValue = dominant.get(field);
            if (dominantValue == null || !dominantValue.endsWith("=" + value)) {
                diffs.add(field + "=" + value);
            }
        });
        if (!diffs.isEmpty()) {
            sb.append("    置信度差异: ").append(String.join("; ", diffs)).append('\n');
        }
    }

    private static String teamLabel(final String spawnKey) {
        return switch (spawnKey == null ? "" : spawnKey.trim().toUpperCase()) {
            case "TEAM_1" -> "TEAM_A（队伍1）";
            case "TEAM_2" -> "TEAM_B（队伍2）";
            default -> spawnKey == null ? "UNKNOWN" : spawnKey;
        };
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
                    .append(" 血量=").append(ReplayDisplayNames.tankMaxHp(p.tankId).isBlank()
                            ? "未知" : ReplayDisplayNames.tankMaxHp(p.tankId))
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

    /** 双方总血量：tankopedia maxHp 求和（基础值，缺失的车辆按 0 计）。 */
    private static int totalHp(final Battle battle, final int team) {
        if (battle.players == null) {
            return 0;
        }
        int total = 0;
        for (final PlayerResult p : battle.players) {
            if (p.team != team) {
                continue;
            }
            final String hp = ReplayDisplayNames.tankMaxHp(p.tankId);
            if (!hp.isBlank()) {
                try {
                    total += Integer.parseInt(hp);
                } catch (final NumberFormatException ignored) {
                    // 非数字血量忽略
                }
            }
        }
        return total;
    }
}

package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.model.EntryHpSource;
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

    static final String PRE_BATTLE_SYSTEM_PROMPT = AiPromptLibrary.zh("prebattle/system");

    static final String PRE_BATTLE_USER_HEADER = AiPromptLibrary.zh("prebattle/user-header");

    static final String CONFIDENCE_LEGEND = AiPromptLibrary.zh("prebattle/confidence-legend");

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
        sb.append("\n=== 双方总血量（tankopedia base 求和；仅当进场满血被回放证明时改用实测含加成值） ===\n");
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
                    .append(" 血量=").append(tankEntryMaxHp(p))
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

    /** 双方总血量：仅已证明的进场满血（OBSERVED_EXACT）用实测值，否则 tankopedia base 求和；均无按 0 计。 */
    private static int totalHp(final Battle battle, final int team) {
        if (battle.players == null) {
            return 0;
        }
        int total = 0;
        for (final PlayerResult p : battle.players) {
            if (p.team != team) {
                continue;
            }
            final Integer hp = tankEntryMaxHpValue(p);
            if (hp != null && hp > 0) {
                total += hp;
            }
        }
        return total;
    }

    /**
     * 单车进场满血量（含 provenance 标注）：仅 OBSERVED_EXACT 输出已证明的进场满血
     * （回放受击前样本证明、含装备/物资加成）；否则输出 tankopedia base 并标注 BASE baseline——
     * 战斗中观测到的 currentHp 不得被包装为赛前进场满血（真实回放 probe 已证伪）。
     */
    private static String tankEntryMaxHp(final PlayerResult p) {
        if (p.entryHpSource == EntryHpSource.OBSERVED_EXACT
                && p.entryHp != null && p.entryHp > 0) {
            return p.entryHp + "（回放实测进场满血）";
        }
        final String base = ReplayDisplayNames.tankMaxHp(p.tankId);
        return base.isBlank() ? "未知" : base + "（tankopedia base）";
    }

    /** 满血量数值（无标注）：OBSERVED_EXACT → entryHp；否则 tankopedia base；均无 → null。 */
    private static Integer tankEntryMaxHpValue(final PlayerResult p) {
        if (p.entryHpSource == EntryHpSource.OBSERVED_EXACT
                && p.entryHp != null && p.entryHp > 0) {
            return p.entryHp;
        }
        return ReplayDisplayNames.tankMaxHpValue(p.tankId);
    }
}

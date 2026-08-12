package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.evidence.TankTacticalProfileRegistry;
import com.wotb.core.replay.map.MapTacticalSemantics;
import com.wotb.core.replay.map.MapTacticalSemanticsRegistry;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

class PreBattlePromptBuilderTest {

    private static Battle battleWithFullResults() {
        final List<PlayerResult> players = new ArrayList<>();
        players.add(resultPlayer(1001, 1, 4481, "Kranvagn"));
        players.add(resultPlayer(1002, 1, 10785, "T110E5"));
        players.add(resultPlayer(2001, 2, 14609, "Leopard 1"));
        players.add(resultPlayer(2002, 2, 12305, "E 50 M"));
        final Battle b = new Battle();
        b.mapName = "erlenberg";
        b.arenaBonusType = 1;
        b.players = players;
        return b;
    }

    private static PlayerResult resultPlayer(final long accountId, final int team,
                                             final long tankId, final String tankName) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.tankId = tankId;
        p.tankName = tankName;
        p.survived = true;
        // 敏感战绩字段：任何泄漏都会让测试失败
        p.damageDealt = 77777;
        p.damageReceived = 88888;
        p.kills = 66;
        p.xp = 12345;
        p.deathTimeMillis = 99999L;
        return p;
    }

    @Test
    void userContentLeaksNoBattleResult() {
        final String content = PreBattlePromptBuilder.buildUserContent(
                battleWithFullResults(), TankTacticalProfileRegistry.load(),
                MapTacticalSemanticsRegistry.load().semanticsFor("erlenberg"));
        assertFalse(content.contains("77777"), "damageDealt must not leak");
        assertFalse(content.contains("88888"), "damageReceived must not leak");
        assertFalse(content.contains("66"), "kills must not leak");
        assertFalse(content.contains("12345"), "xp must not leak");
        assertFalse(content.contains("99999"), "deathTime must not leak");
    }

    @Test
    void userContentContainsRosterAndProfiles() {
        final String content = PreBattlePromptBuilder.buildUserContent(
                battleWithFullResults(), TankTacticalProfileRegistry.load(),
                MapTacticalSemanticsRegistry.load().semanticsFor("erlenberg"));
        assertTrue(content.contains("TEAM_A（队伍1）阵容"));
        assertTrue(content.contains("TEAM_B（队伍2）阵容"));
        assertTrue(content.contains("Kranvagn"));
        assertTrue(content.contains("Leopard 1"));
        assertTrue(content.contains("roles="));
        assertTrue(content.contains("=== 地图战术语义 ==="));
        assertTrue(content.contains("数据来源: CLIENT_RESOURCE_DERIVED"));
        assertFalse(content.contains("地图语义数据当前不可用"));
    }

    @Test
    void userContentContainsTotalHpAndPerVehicleHp() {
        final String content = PreBattlePromptBuilder.buildUserContent(
                battleWithFullResults(), TankTacticalProfileRegistry.load(),
                MapTacticalSemanticsRegistry.load().semanticsFor("erlenberg"));
        assertTrue(content.contains("双方总血量（tankopedia maxHp 求和"));
        assertTrue(content.contains("TEAM_A 总血量="));
        assertTrue(content.contains("TEAM_B 总血量="));
        assertTrue(content.contains("血量=2400"), "Kranvagn tankopedia maxHp must be rendered");
        assertTrue(content.contains("血量="), "per-vehicle hp must be rendered");
    }

    @Test
    void systemPromptAllowsPreBattleHpAndRequiresStagedPlans() {
        final String system = PreBattlePromptBuilder.PRE_BATTLE_SYSTEM_PROMPT;
        assertTrue(system.contains("车辆基础血量（tankopedia maxHp）与双方总血量为赛前车辆属性"));
        assertTrue(system.contains("【开局】【中期】【残局】"),
                "preferredPlans must be staged (opening/midgame/lategame)");
    }

    @Test
    void mapSemanticsPromptPreservesConfidenceBoundaries() {
        final String content = PreBattlePromptBuilder.buildUserContent(
                battleWithFullResults(), TankTacticalProfileRegistry.load(),
                MapTacticalSemanticsRegistry.load().semanticsFor("desert_train"));
        assertTrue(content.contains("=== 可信度图例 ==="));
        assertTrue(content.contains("EXACT_CLIENT_DATA / EXACT_SCENE_DATA: 客户端直接事实"));
        assertTrue(content.contains(
                "NAME_HEURISTIC: 对象位置精确；建筑/植被/铁路等类别由资源名推断"));
        assertTrue(content.contains(
                "GRID_RULE_DERIVED: 区域名称、区域边界与区域合并结果是确定性规则候选"));
        assertTrue(content.contains("RULE_DERIVED_CANDIDATE: favors/risks 只是战术假设候选"));
        assertTrue(content.contains("人工地图核验: 已完成"));
        assertFalse(content.contains("未完成"),
                "all repository map semantics are human-verified");
        assertTrue(content.contains("本图区域置信度（与下方可信度图例对应）"));
        assertTrue(content.contains("areaBoundary=GRID_RULE_DERIVED"));
        assertTrue(content.contains("objectCategories=NAME_HEURISTIC"));
        assertFalse(content.contains("区域边界是已验证的客户端事实"));
        assertFalse(content.contains("建筑/植被/铁路等类别已经验证"));
    }

    @Test
    void areaConfidenceDiffIsRenderedWhenDifferentFromDominant() {
        final Map<String, MapTacticalSemantics.TacticalArea> areas = new LinkedHashMap<>();
        areas.put("AREA_A", new MapTacticalSemantics.TacticalArea(
                "AREA_A", "常规区", List.of("LOW_GROUND"), List.of("GRID_REGION_1"),
                List.of(), List.of(), List.of(),
                new MapTacticalSemantics.AreaConfidence(
                        "EXACT_CLIENT_DATA", "EXACT_CLIENT_DATA", "NAME_HEURISTIC",
                        "GRID_RULE_DERIVED", "RULE_DERIVED_CANDIDATE")));
        areas.put("AREA_B", new MapTacticalSemantics.TacticalArea(
                "AREA_B", "常规区", List.of("LOW_GROUND"), List.of("GRID_REGION_2"),
                List.of(), List.of(), List.of(),
                new MapTacticalSemantics.AreaConfidence(
                        "EXACT_CLIENT_DATA", "EXACT_CLIENT_DATA", "NAME_HEURISTIC",
                        "GRID_RULE_DERIVED", "RULE_DERIVED_CANDIDATE")));
        areas.put("AREA_ODD", new MapTacticalSemantics.TacticalArea(
                "AREA_ODD", "异常区", List.of("LOW_GROUND"), List.of("GRID_REGION_9"),
                List.of(), List.of(), List.of(),
                new MapTacticalSemantics.AreaConfidence(
                        "EXACT_SCENE_DATA", "EXACT_CLIENT_DATA", "NAME_HEURISTIC",
                        "GRID_RULE_DERIVED", "RULE_DERIVED_CANDIDATE")));
        final MapTacticalSemantics custom = new MapTacticalSemantics(
                "desert_train", areas, List.of(), Map.of(), false,
                "CLIENT_RESOURCE_DERIVED", "Desert Sands");
        final String content =
                PreBattlePromptBuilder.buildMapSemanticsSection("desert_train", custom);
        assertTrue(content.contains("置信度差异: geometry=EXACT_SCENE_DATA"));
        assertFalse(content.contains("置信度差异: objectCategories"));
    }

    @Test
    void mapSemanticsSectionShowsReadableMapNameAndInternalCode() {
        final Battle battle = battleWithFullResults();
        battle.mapName = "desert_train";
        final String content = PreBattlePromptBuilder.buildUserContent(
                battle, TankTacticalProfileRegistry.load(),
                MapTacticalSemanticsRegistry.load().semanticsFor("desert_train"));
        assertTrue(content.contains("地图: \"Desert Sands\"（内部 code: \"desert_train\"）"));
    }

    @Test
    void unknownMapRendersExplicitUnknownInsteadOfFabrication() {
        final Battle battle = battleWithFullResults();
        battle.mapName = "not_a_real_map";
        final String content = PreBattlePromptBuilder.buildUserContent(
                battle, TankTacticalProfileRegistry.load(),
                MapTacticalSemantics.UNKNOWN);
        assertTrue(content.contains("UNKNOWN（该地图暂无语义数据，禁止编造区域名与点位）"));
        assertFalse(content.contains("HILL"));
    }

    @Test
    void mapWithSemanticizerDataRendersRealAreasRelationshipsAndSpawns() {
        final Battle battle = battleWithFullResults();
        battle.mapName = "desert_train";
        final String content = PreBattlePromptBuilder.buildUserContent(
                battle, TankTacticalProfileRegistry.load(),
                MapTacticalSemanticsRegistry.load().semanticsFor("desert_train"));
        assertTrue(content.contains("=== 地图战术语义 ==="));
        assertTrue(content.contains("HARD_COVER_ZONE_01"));
          assertTrue(content.contains("九宫格=GRID_REGION_3,GRID_REGION_6,GRID_REGION_9"));
          assertTrue(content.contains("适合(规则候选)"));
          assertTrue(content.contains("区域关系（原始语义"));
          assertTrue(content.contains(" ADJACENT_TO "));
          assertTrue(content.contains("confidence=EXACT_GRID_TOPOLOGY"));
          assertTrue(content.contains("reason="));
          assertTrue(content.contains("14 个出生点"));
        assertTrue(content.contains("（状态 EXACT_SCENE_DATA）"));
        assertTrue(content.contains("TEAM_A（队伍1）"));
        assertTrue(content.contains("TEAM_B（队伍2）"));
        assertFalse(content.contains("战术语义: UNKNOWN（该地图暂无语义数据"));
          assertFalse(content.contains("出生点语义: UNKNOWN（当前无法可靠确定）"));
      }

      @Test
      void mapRelationshipsKeepRawSemanticsAndAdjacencyBoundary() {
          final String content = PreBattlePromptBuilder.buildUserContent(
                  battleWithFullResults(), TankTacticalProfileRegistry.load(),
                  MapTacticalSemanticsRegistry.load().semanticsFor("desert_train"));
          assertTrue(content.contains("CONTAINS_CONTROL_POINT"));
          assertTrue(content.contains("CONTAINS_STRATEGIC_POINT"));
          assertTrue(content.contains("confidence=EXACT_SCENE_DATA"));
          assertFalse(content.contains(" connects:"));
          assertFalse(content.contains(" higherThan:"));
          assertFalse(content.contains(" containsPoints:"));
          assertTrue(PreBattlePromptBuilder.PRE_BATTLE_SYSTEM_PROMPT
                  .contains("ADJACENT_TO 只表示确定性分析网格相邻"));
          assertTrue(PreBattlePromptBuilder.PRE_BATTLE_SYSTEM_PROMPT
                  .contains("不代表存在可通行路线"));
          assertTrue(PreBattlePromptBuilder.PRE_BATTLE_SYSTEM_PROMPT
                  .contains("不得据此声称 CONTROLS 或 ENABLES_PRESSURE_AGAINST"));
      }

    @Test
    void systemPromptBansResultReferenceAndRequiresJson() {
        assertTrue(PreBattlePromptBuilder.PRE_BATTLE_SYSTEM_PROMPT.contains("严禁引用"));
        assertTrue(PreBattlePromptBuilder.PRE_BATTLE_SYSTEM_PROMPT.contains("JSON"));
        assertTrue(PreBattlePromptBuilder.PRE_BATTLE_SYSTEM_PROMPT.contains("TEAM_A"));
        assertTrue(PreBattlePromptBuilder.PRE_BATTLE_SYSTEM_PROMPT
                .contains("地图战术语义只使用下方提供的数据"));
        assertFalse(PreBattlePromptBuilder.PRE_BATTLE_SYSTEM_PROMPT
                .contains("地图语义数据当前不可用"));
    }
}

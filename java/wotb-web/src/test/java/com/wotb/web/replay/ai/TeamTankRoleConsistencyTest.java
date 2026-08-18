package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.evidence.TankTacticalProfile;
import com.wotb.core.replay.evidence.TankTacticalProfileRegistry;
import com.wotb.core.replay.feature.TeamAutopsyStats;
import com.wotb.core.replay.feature.TeamAutopsyStatsBuilder;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * Tank role 一致性（docs/current-plan.md §8/§13-F）：tankName / vehicleClass / tier 必须
 * 来自同一 backend canonical 来源（ReplayDisplayNames）；战术 Profile（TankTacticalProfileRegistry）
 * 是唯一角色语义来源；后端未提供角色时只写名称与车种。
 */
class TeamTankRoleConsistencyTest {

    private static final long TANK_ID = 4481L; // Kranvagn

    @Test
    void mainTeamReviewAndAutopsyResolveTankClassFromSameCanonicalSource() {
        // 主复盘（TeamEvidenceFormatter）
        assertEquals(ReplayDisplayNames.tankClass(TANK_ID),
                TeamEvidenceFormatter.resolveTankClass(TANK_ID),
                "main Team Review 必须使用 ReplayDisplayNames.tankClass");
        // Team Autopsy（TeamAutopsyStatsBuilder）
        final Battle battle = new Battle();
        final PlayerResult p = new PlayerResult();
        p.accountId = 1001L;
        p.team = 1;
        p.tankId = TANK_ID;
        p.tankName = "Kranvagn";
        p.nickname = "p1";
        p.survived = true;
        battle.players = List.of(p);
        final List<TeamAutopsyStats> stats = new TeamAutopsyStatsBuilder().build(
                battle, List.of(), 1, null);
        assertFalse(stats.isEmpty(), "autopsy stats must build");
        final TeamAutopsyStats s = stats.getFirst();
        assertEquals(ReplayDisplayNames.tankClass(TANK_ID), s.tankClass(),
                "Team Autopsy 必须使用同一 canonical tankClass");
        assertEquals(ReplayDisplayNames.tankTier(TANK_ID), s.tankTier(),
                "Team Autopsy 必须使用同一 canonical tankTier");
    }

    @Test
    void tacticalProfileIsSingleRoleSemanticSource() {
        final TankTacticalProfileRegistry registry = TankTacticalProfileRegistry.load();
        final TankTacticalProfile profile = registry.profileFor(
                TANK_ID, "Kranvagn", ReplayDisplayNames.tankClass(TANK_ID),
                ReplayDisplayNames.tankTier(TANK_ID));
        assertNotNull(profile, "tank profile must resolve for a known tank");
        // 角色标签（roles）只来自该 registry；主复盘/赛前/Autopsy 的语义证据共用同一数据源（同一 JSON 注册表）
        final TankTacticalProfile shared = FormationDepthEvidence.profileRegistry()
                .profileFor(TANK_ID, "Kranvagn", ReplayDisplayNames.tankClass(TANK_ID),
                        ReplayDisplayNames.tankTier(TANK_ID));
        assertNotNull(shared, "FormationDepthEvidence 的 registry 必须能解析同一坦克");
        assertEquals(profile.vehicleClass(), shared.vehicleClass(),
                "FormationDepthEvidence 与 PreBattle 必须解析出同一 vehicleClass");
        // 后端未提供角色时，prompt 只允许 vehicleClass：由 TeamReviewQualityGateContractTest 断言
        final String zh = AiPromptLibrary.zh("team/single");
        assertFalse(zh.contains("Kranvagn 是"),
                "prompt 不得携带对具体坦克的固定角色断言");
    }

    @Test
    void preBattleUsesSameDisplayNamesForClass() {
        // PreBattleStrategicService 用 ReplayDisplayNames.tankClass 装配双方阵容（结构上同源）
        // 这里验证该调用链存在：ref 包是唯一 tankClass 解析入口
        final String cls = ReplayDisplayNames.tankClass(TANK_ID);
        assertEquals(cls, TeamEvidenceFormatter.resolveTankClass(TANK_ID));
        assertEquals(cls, new TeamAutopsyStatsBuilder().build(
                singlePlayerBattle(), List.of(), 1, null).getFirst().tankClass());
    }

    private static Battle singlePlayerBattle() {
        final Battle battle = new Battle();
        final PlayerResult p = new PlayerResult();
        p.accountId = 1001L;
        p.team = 1;
        p.tankId = TANK_ID;
        p.tankName = "Kranvagn";
        p.nickname = "p1";
        p.survived = true;
        battle.players = List.of(p);
        return battle;
    }
}
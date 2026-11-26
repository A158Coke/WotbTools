package com.wotb.ai.review;

import com.wotb.ai.prompt.AiPromptLibrary;

import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.evidence.TankTacticalProfile;
import com.wotb.core.replay.evidence.TankTacticalProfileRegistry;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class TeamTankRoleConsistencyTest {

    private static final long TANK_ID = 4481L;

    @Test
    void mainTeamReviewResolvesTankClassFromCanonicalSource() {
        assertEquals(ReplayDisplayNames.tankClass(TANK_ID),
                TeamRosterFormatter.resolveTankClass(TANK_ID),
                "main Team Review 必须使用 ReplayDisplayNames.tankClass");
    }

    @Test
    void tacticalProfileIsSingleRoleSemanticSource() {
        final TankTacticalProfileRegistry registry = TankTacticalProfileRegistry.load();
        final TankTacticalProfile profile = registry.profileFor(
                TANK_ID, "Kranvagn", ReplayDisplayNames.tankClass(TANK_ID),
                ReplayDisplayNames.tankTier(TANK_ID));
        assertNotNull(profile, "tank profile must resolve for a known tank");
        final TankTacticalProfile shared = FormationDepthEvidence.profileRegistry()
                .profileFor(TANK_ID, "Kranvagn", ReplayDisplayNames.tankClass(TANK_ID),
                        ReplayDisplayNames.tankTier(TANK_ID));
        assertNotNull(shared, "FormationDepthEvidence 的 registry 必须能解析同一坦克");
        assertEquals(profile.vehicleClass(), shared.vehicleClass(),
                "FormationDepthEvidence 与 PreBattle 必须解析出同一 vehicleClass");
        final String zh = AiPromptLibrary.zh("team/single");
        assertFalse(zh.contains("Kranvagn 是"),
                "prompt 不得携带对具体坦克的固定角色断言");
    }
}

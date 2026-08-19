package com.wotb.web.replay.ai;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link PreBattleSectionRenderer} 契约：用户可见中文、无机器段头、
 * 中性/视角化标签、Call #1 不可用时返回 null。
 */
class PreBattleSectionRendererTest {

    private static final PreBattleStrategicPrior PRIOR = new PreBattleStrategicPrior(
            new PreBattleStrategicPrior.TeamProfile(
                    Map.of("mobility", "HIGH"),
                    List.of("重坦正面推进"),
                    List.of("转场慢"),
                    List.of("左路集结")),
            new PreBattleStrategicPrior.TeamProfile(
                    Map.of("mobility", "MEDIUM"),
                    List.of("中坦机动拉扯"),
                    List.of(),
                    List.of("中路控制")),
            List.of(new PreBattleStrategicPrior.KeyMatchup(
                    "GRID_REGION_5", "TEAM_A", "正面火力占优")),
            List.of(new PreBattleStrategicPrior.StrategicWinCondition(
                    "TEAM_A", "前十分钟控制左路")),
            List.of(new PreBattleStrategicPrior.StrategicHypothesis(
                    "H1", "开局左路集结", "地图出生点偏左")));

    @Test
    void nullPriorRendersNull() {
        assertNull(PreBattleSectionRenderer.render(null));
        assertNull(PreBattleSectionRenderer.render(null, 1, "clan"));
    }

    @Test
    void emptyPriorRendersNull() {
        final PreBattleStrategicPrior empty = new PreBattleStrategicPrior(
                null, null, List.of(), List.of(), List.of());
        assertNull(PreBattleSectionRenderer.render(empty));
        assertNull(PreBattleSectionRenderer.render(empty, 2, null));
    }

    @Test
    void neutralRendererUsesTeamOneAndTeamTwoLabels() {
        final String section = PreBattleSectionRenderer.render(PRIOR);
        assertNotNull(section);
        assertTrue(section.contains("赛前预测"));
        assertTrue(section.contains("队伍1画像"));
        assertTrue(section.contains("队伍2画像"));
        assertTrue(section.contains("重坦正面推进"));
        assertTrue(section.contains("中坦机动拉扯"));
        assertTrue(section.contains("关键对阵"));
        assertTrue(section.contains("战略胜机"));
        assertTrue(section.contains("战略假设"));
        assertFalse(section.contains("PRE-BATTLE"));
        assertFalse(section.contains("TEAM_A"), "internal team tokens must be replaced");
        assertFalse(section.contains("TEAM_B"), "internal team tokens must be replaced");
        assertTrue(section.contains("区域 5区"), "GRID_REGION_5 must render as 5区");
        assertFalse(section.contains("GRID_REGION"), "machine region token must not leak");
        assertTrue(section.contains("H1：开局左路集结"));
    }

    @Test
    void randomBattlePerspectiveOneShowsFriendlyEnemyWithoutRecorderName() {
        final String section = PreBattleSectionRenderer.renderRandomBattle(
                PRIOR, 1, AllowedLanguage.ZH);
        assertNotNull(section);
        assertTrue(section.contains("友军画像"), "friendly label without recorder nickname");
        assertTrue(section.contains("敌军画像"), "enemy label without recorder nickname");
        assertFalse(section.contains("TEAM_A"));
        assertFalse(section.contains("TEAM_B"));
    }

    @Test
    void randomBattlePerspectiveTwoSwapsToFriendlyEnemy() {
        final String section = PreBattleSectionRenderer.renderRandomBattle(
                PRIOR, 2, AllowedLanguage.ZH);
        assertNotNull(section);
        assertTrue(section.contains("友军画像"));
        assertTrue(section.contains("敌军画像"));
    }

    @Test
    void randomBattleEnPerspectiveOneShowsFriendlyEnemy() {
        final String section = PreBattleSectionRenderer.renderRandomBattle(
                PRIOR, 1, AllowedLanguage.EN);
        assertNotNull(section);
        assertTrue(section.contains("Friendly Profile"));
        assertTrue(section.contains("Enemy Profile"));
    }

    @Test
    void teamViewPerspectiveOneKeepsPriorTeamAAsOurs() {
        final String section = PreBattleSectionRenderer.render(PRIOR, 1, "CLAN1");
        assertNotNull(section);
        assertTrue(section.contains("我方（CLAN1）画像"), "perspective team A is ours");
        assertTrue(section.contains("对方画像"));
        assertTrue(section.contains("重坦正面推进"), "teamA strengths belong to 我方");
        assertTrue(section.contains("我方（CLAN1）：前十分钟控制左路"),
                "TEAM_A win condition token must map to 我方 label");
    }

    @Test
    void teamViewPerspectiveTwoSwapsTeams() {
        final String section = PreBattleSectionRenderer.render(PRIOR, 2, null);
        assertNotNull(section);
        assertTrue(section.contains("我方画像"), "perspective team 2 is ours");
        assertTrue(section.contains("对方画像"));
        // perspectiveTeam=2 时 teamB（中坦机动拉扯）为视角队伍
        assertTrue(section.contains("中坦机动拉扯"));
        assertTrue(section.contains("对方：前十分钟控制左路"),
                "after swap, original TEAM_A condition belongs to the opponent");
        assertFalse(section.contains("TEAM_A"));
        assertFalse(section.contains("TEAM_B"));
    }

    @Test
    void partialPriorRendersOnlyAvailableBlocks() {
        final PreBattleStrategicPrior hypothesesOnly = new PreBattleStrategicPrior(
                null, null, List.of(), List.of(), List.of(
                        new PreBattleStrategicPrior.StrategicHypothesis("H2", "蹲坑预期", "地图空旷")));
        final String section = PreBattleSectionRenderer.render(hypothesesOnly);
        assertNotNull(section);
        assertTrue(section.contains("战略假设"));
        assertTrue(section.contains("H2：蹲坑预期"));
        assertFalse(section.contains("画像"), "no team profile data -> no profile blocks");
    }

    @Test
    void renderReturnsStableMarkdownShape() {
        final String section = PreBattleSectionRenderer.render(PRIOR);
        assertEquals("## 赛前预测\n", section.substring(0, "## 赛前预测\n".length()));
        assertTrue(section.contains("- 阵容属性：机动性=高\n"),
                "composition keys/values must be translated to Chinese: " + section);
        assertTrue(section.contains("- 优势：重坦正面推进\n"));
        assertTrue(section.contains("- 劣势：转场慢\n"));
        assertTrue(section.contains("- 预期打法：左路集结\n"));
    }

    @Test
    void teamVariantsAreMappedToPerspectiveLabels() {
        final PreBattleStrategicPrior prior = new PreBattleStrategicPrior(
                new PreBattleStrategicPrior.TeamProfile(
                        Map.of(), List.of("A队正面推进"), List.of(), List.of()),
                new PreBattleStrategicPrior.TeamProfile(
                        Map.of(), List.of("B队机动拉扯"), List.of(), List.of()),
                List.of(new PreBattleStrategicPrior.KeyMatchup(
                        "GRID_REGION_5", "A 队", "B队需避免正面接触")),
                List.of(new PreBattleStrategicPrior.StrategicWinCondition(
                        "B队", "利用机动拉扯")),
                List.of());
        final String section = PreBattleSectionRenderer.render(prior, 2, "CHRD");
        assertFalse(section.contains("A队"), "A队 variant must be replaced: " + section);
        assertFalse(section.contains("B队"), "B队 variant must be replaced: " + section);
        assertTrue(section.contains("区域 5区：对方（"),
                "A 队（raw team 1）在视角队伍 2 时应映射为对方：" + section);
        assertTrue(section.contains("我方（CHRD）画像"), "B队（视角队伍）应映射为我方：" + section);
    }

    @Test
    void areaIdsMapToChineseNameAndGridRegions() {
        final PreBattleStrategicPrior prior = new PreBattleStrategicPrior(
                null, null,
                List.of(new PreBattleStrategicPrior.KeyMatchup(
                        "ELEVATED_TERRAIN_01", "TEAM_A", "山脊卖头")),
                List.of(), List.of());
        final String section = PreBattleSectionRenderer.render(prior, 1, null, AllowedLanguage.ZH, "neptune");
        assertTrue(section.contains("东侧高地区域（3/5/6/9区）"),
                "AREA ID must map to Chinese label + grid regions: " + section);
        assertFalse(section.contains("ELEVATED_TERRAIN_01"),
                "raw AREA ID must not leak: " + section);
    }

    @Test
    void enAreaNamesUseGenericRegionsWithoutChineseLabel() {
        final PreBattleStrategicPrior prior = new PreBattleStrategicPrior(
                null, null,
                List.of(new PreBattleStrategicPrior.KeyMatchup(
                        "ELEVATED_TERRAIN_01", "TEAM_A", "ridge")),
                List.of(), List.of());
        final String section = PreBattleSectionRenderer.render(
                prior, 1, null, AllowedLanguage.EN, "neptune");
        assertTrue(section.contains("Regions 3/5/6/9"),
                "EN must keep grid regions: " + section);
        assertFalse(section.contains("东侧高地区域"),
                "EN must not leak Chinese semantic label: " + section);
        assertFalse(section.contains("ELEVATED_TERRAIN_01"),
                "EN must not leak raw AREA ID: " + section);
    }

    @Test
    void ruAreaNamesUseGenericRegionsWithoutChineseLabel() {
        final PreBattleStrategicPrior prior = new PreBattleStrategicPrior(
                null, null,
                List.of(new PreBattleStrategicPrior.KeyMatchup(
                        "ELEVATED_TERRAIN_01", "TEAM_A", "гребень")),
                List.of(), List.of());
        final String section = PreBattleSectionRenderer.render(
                prior, 1, null, AllowedLanguage.RU, "neptune");
        assertTrue(section.contains("Области 3/5/6/9"),
                "RU must keep grid regions: " + section);
        assertFalse(section.contains("东侧高地区域"),
                "RU must not leak Chinese semantic label: " + section);
        assertFalse(section.contains("ELEVATED_TERRAIN_01"),
                "RU must not leak raw AREA ID: " + section);
    }

    @Test
    void compositionTranslatedToEnglish() {
        final String section = PreBattleSectionRenderer.render(PRIOR, 1, null, AllowedLanguage.EN);
        assertTrue(section.contains("Mobility=High"),
                "composition key/value must follow requested language: " + section);
    }

    @Test
    void rendererKeepsClusterTermsForFinalSanitizeBoundary() {
        // renderer 无 authoritative Battle context（nickname/tankName/clan 可能合法含「簇」），
        // 不得提前裸替换——「簇」字兜底由最终输出边界（AiReplayReviewService.sanitizeClusterTerms
        // 带 protected literals）统一处理；此处守护 renderer 不破坏 proper noun。
        final PreBattleStrategicPrior clusterPrior = new PreBattleStrategicPrior(
                new PreBattleStrategicPrior.TeamProfile(
                        Map.of(),
                        List.of("多车同簇推进"),
                        List.of("主力簇分簇行动"),
                        List.of("一簇强攻")),
                null, List.of(), List.of(), List.of());
        final String section = PreBattleSectionRenderer.render(clusterPrior);
        assertTrue(section.contains("多车同簇推进"), "同簇 必须原样保留（最终边界处理）: " + section);
        assertTrue(section.contains("主力簇分簇行动"), "主力簇/分簇 必须原样保留: " + section);
        assertTrue(section.contains("一簇强攻"), "一簇 必须原样保留: " + section);
        assertFalse(section.contains("集群推进"), "renderer 不得提前替换成集群: " + section);
    }

    @Test
    void rendererKeepsAllClusterVariantsVerbatim() {
        final PreBattleStrategicPrior clusterPrior = new PreBattleStrategicPrior(
                new PreBattleStrategicPrior.TeamProfile(
                        Map.of("mobility", "高簇"),
                        List.of("小簇袭扰", "车辆簇集中"),
                        List.of("簇状推进"),
                        List.of("簇拥出击")),
                null,
                List.of(new PreBattleStrategicPrior.KeyMatchup(
                        "GRID_REGION_5", "TEAM_A", "主力簇并进")),
                List.of(new PreBattleStrategicPrior.StrategicWinCondition(
                        "TEAM_A", "多簇拉扯")),
                List.of(new PreBattleStrategicPrior.StrategicHypothesis(
                        "H1", "簇", "一簇")));
        final String section = PreBattleSectionRenderer.render(clusterPrior);
        assertTrue(section.contains("小簇袭扰"), section);
        assertTrue(section.contains("车辆簇集中"), section);
        assertTrue(section.contains("簇状推进"), section);
        assertTrue(section.contains("簇拥出击"), section);
        assertTrue(section.contains("机动性=高簇"), section);
        assertTrue(section.contains("主力簇并进"), section);
        assertTrue(section.contains("多簇拉扯"), section);
        assertTrue(section.contains("H1：簇"), section);
    }

    @Test
    void rendererKeepsEveryClusterVariantAcrossAllFieldsVerbatim() {
        // 每个用户可见自由文本字段都塞入不同「簇」形态：strengths/weaknesses/plans/
        // composition 值/keyMatchups area+advantage+reason/winConditions/hypotheses。
        // renderer 不做「簇」替换（无 authoritative context），全部原样保留给最终边界。
        final PreBattleStrategicPrior dirty = new PreBattleStrategicPrior(
                new PreBattleStrategicPrior.TeamProfile(
                        Map.of("mobility", "高簇", "burstPotential", "MEDIUM"),
                        List.of("小簇袭扰"),
                        List.of("车辆簇集中"),
                        List.of("簇状推进")),
                new PreBattleStrategicPrior.TeamProfile(
                        Map.of(),
                        List.of("簇拥集火"),
                        List.of("多簇分散"),
                        List.of("主力簇并进")),
                List.of(new PreBattleStrategicPrior.KeyMatchup(
                        "GRID_REGION_5", "TEAM_A", "一簇强攻")),
                List.of(new PreBattleStrategicPrior.StrategicWinCondition(
                        "TEAM_A", "成簇集结")),
                List.of(new PreBattleStrategicPrior.StrategicHypothesis(
                        "H1", "分簇行动", "同簇换线")));
        final String section = PreBattleSectionRenderer.render(dirty);
        for (final String verbatim : List.of("高簇", "小簇袭扰", "车辆簇集中", "簇状推进",
                "簇拥集火", "多簇分散", "主力簇并进", "一簇强攻", "成簇集结", "分簇行动", "同簇换线")) {
            assertTrue(section.contains(verbatim),
                    "renderer 必须原样保留「" + verbatim + "」（最终边界统一 sanitize）: " + section);
        }
    }
}

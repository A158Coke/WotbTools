package com.wotb.web.replay.ai;

import com.wotb.core.model.Source;
import com.wotb.core.parse.ReplayArchiveReader;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.PlayerSideResolver;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * BEHIND_LINE_HP_ADVANTAGE（吸血/避战候选）真实样本标定探针（手动维护，不进常规 CI 断言）：
 * 扫描 common/data（递归）与 common/fixtures/replays 的全部 .wotbreplay，逐样本输出
 * {@link BehindLineHpEvidence#renderTeamSection}（团队视角=录像者队伍）的命中名单与 degree 分级，
 * 供用户审阅并标定阈值（×1.2 血量优势/档位）。无样本自动跳过。
 */
class BehindLineEvidenceProbeTest {

    private static final Path REPO_COMMON = Path.of("../../common");

    @Test
    void behindLineHpAdvantageProbe() throws Exception {
        final List<Path> samples = new ArrayList<>();
        if (Files.isDirectory(REPO_COMMON)) {
            try (var walk = Files.walk(REPO_COMMON)) {
                walk.filter(p -> p.toString().endsWith(".wotbreplay"))
                        .filter(Files::isRegularFile)
                        .sorted()
                        .forEach(samples::add);
            }
        }
        Assumptions.assumeTrue(!samples.isEmpty(), "no replay samples under common/");
        System.out.println("== BEHIND_LINE_HP_ADVANTAGE probe ==");
        for (final Path sample : samples) {
            System.out.println("===== " + sample + " =====");
            try {
                final byte[] bytes = Files.readAllBytes(sample);
                final ReplayProcessingResult result = new DefaultReplayProcessingFacade()
                        .process(new Source(sample.getFileName().toString(), bytes),
                                ReplayProcessingOptions.full());
                final var battle = result.battle();
                final var recon = result.reconstruction();
                if (battle == null || recon == null || battle.players == null) {
                    System.out.println("  battle/recon unavailable");
                    continue;
                }
                final Integer recorderTeam = PlayerSideResolver.resolveRecorderTeam(battle);
                if (recorderTeam == null) {
                    System.out.println("  recorderTeam unknown");
                    continue;
                }
                final String section = BehindLineHpEvidence.renderTeamSection(
                        battle, recon, recorderTeam);
                System.out.println(section.isEmpty() ? "  (无命中)" : section);
                // 地图控制权（controlRegions）：与阵型段同源输出，供用户审区域归属
                final String formation = FormationDepthEvidence.renderSection(
                        battle, recon, recorderTeam,
                        battle.mapName == null ? null : battle.mapName);
                if (formation.contains("controlRegions") || formation.contains("noArmorNote")) {
                    System.out.println(formation);
                }
            } catch (Exception e) {
                System.out.println("  ERROR " + e);
            }
        }
    }
}

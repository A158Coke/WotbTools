package com.wotb.web.replay.ai;

import com.wotb.core.model.Source;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.PlayerSideResolver;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * RELATIVE_DEPTH_HP_MEASUREMENT 真实样本标定探针（手动维护，不进常规 CI 断言）：
 * 扫描 common/data（递归）与 common/fixtures/replays 的全部 .wotbreplay，逐样本输出
 * {@link RelativeDepthHpEvidence#renderTeamSection}（团队视角=录像者队伍）的测量行与跨阶段 salience，
 * 供用户审阅并标定阈值（×1.2 血量比率优势 salience filter）。无样本自动跳过。
 */
class RelativeDepthHpEvidenceProbeTest {

    private static final Path REPO_COMMON = Path.of("../../common");

    @Test
    void relativeDepthHpProbe() throws Exception {
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
        System.out.println("== RELATIVE_DEPTH_HP_MEASUREMENT probe ==");
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
                final String section = RelativeDepthHpEvidence.renderTeamSection(
                        battle, recon, recorderTeam, false);
                System.out.println(section.isEmpty() ? "  (无命中)" : section);
                // OBSERVED_DAMAGE_IS_PARTIAL 对照：事件流观测不全时不得出现避战推断
                final String partial = RelativeDepthHpEvidence.renderTeamSection(
                        battle, recon, recorderTeam, true);
                if (partial.contains("避战")) {
                    System.out.println("  !! PARTIAL_MODE_STILL_SAYS_AVOIDANCE");
                } else if (!partial.isEmpty()) {
                    System.out.println("  [partial 对照] 无避战推断；测量行如下:");
                    partial.lines().filter(l -> l.contains("observedAttackEvents"))
                            .forEach(l -> System.out.println("    " + l));
                }
                // 区域覆盖测量（REGION_COVERAGE_MEASUREMENTS）：与阵型段同源输出，供用户审区域归属
                final String formation = FormationDepthEvidence.renderSection(
                        battle, recon, recorderTeam,
                        battle.mapName == null ? null : battle.mapName);
                if (formation.contains("REGION_COVERAGE_MEASUREMENTS")) {
                    System.out.println(formation);
                }
            } catch (Exception e) {
                System.out.println("  ERROR " + e);
            }
        }
    }
}

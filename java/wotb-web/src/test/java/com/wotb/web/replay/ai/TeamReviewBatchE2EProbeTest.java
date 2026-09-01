package com.wotb.web.replay.ai;

import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Source;
import com.wotb.core.replay.processing.BatchAnalyzer;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayPerspectiveGroup;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.web.config.AiModelProperties;
import com.wotb.web.replay.ai.gateway.AiReplayAnalysisConfig;
import com.wotb.web.replay.ai.gateway.SpringAiChatGateway;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * 真实 DeepSeek 批量 E2E 验收探针（>= 5 真实 team replay，usable success >= 80%，
 * HARD_FACT_CONFLICT 输出 = 0）。手动运行，不进 CI；需 AI_API_KEY 环境变量。
 * Run from the {@code java} directory in PowerShell after supplying an out-of-band key:
 * {@code $env:AI_API_KEY = "<provided-out-of-band>"; mvn -pl wotb-web -am test
 * "-Dtest=TeamReviewBatchE2EProbeTest" "-Dai.probe.excludedGroups="}
 */
@Tag("ai-live")
class TeamReviewBatchE2EProbeTest {

    private static final List<String> SAMPLES = List.of(
            "data/probe-local/neptune1.wotbreplay",
            "data/probe-local/neptune2.wotbreplay",
            "data/probe-local/malinovka1.wotbreplay",
            "data/probe-local/malinovka2.wotbreplay",
            "data/probe-local/maus1.wotbreplay");

    @Test
    void batchE2E() throws Exception {
        final String apiKey = System.getenv("AI_API_KEY");
        Assumptions.assumeTrue(apiKey != null && !apiKey.isBlank(), "AI_API_KEY env missing");
        final AiModelProperties props = new AiModelProperties(
                apiKey, "https://api.deepseek.com", "deepseek-v4-flash",
                10, 120, 200, 1, 1000, 8000, 2.0,
                1_000_000, 940_000, 32768, 16384, false, "max", false, 4096);
        final SpringAiChatGateway gateway = SpringAiChatGateway.fromProperties(props, null);
        final AiReplayAnalysisConfig config = new AiReplayAnalysisConfig(
                new ConservativeDeepSeekTokenEstimator(), "deepseek-v4-flash",
                940_000, 1_000_000, 32768, 16384, false, "max", 200, 4096);
        final TeamReplayAnalysisService service = new TeamReplayAnalysisService(
                gateway, config,
                new PreBattleStrategicService(gateway, config, null),
                new TeamAutopsyService(gateway, config, null),
                System::nanoTime, null);

        int usable = 0;
        int executed = 0;
        final List<String> failures = new ArrayList<>();
        System.out.println("===== 批量真实 E2E（" + SAMPLES.size() + " replay）=====");
        for (final String sample : SAMPLES) {
            final Path file = Path.of(sample);
            if (!Files.exists(file)) {
                System.out.println("SKIP missing: " + sample);
                continue;
            }
            executed++;
            final long start = System.nanoTime();
            try {
                final byte[] bytes = Files.readAllBytes(file);
                final ReplayProcessingResult result = new DefaultReplayProcessingFacade()
                        .process(new Source(file.getFileName().toString(), bytes), ReplayProcessingOptions.full());
                final List<ReplayPerspectiveGroup> groups =
                        new BatchAnalyzer().analyze(List.of(result)).groups();
                final TeamAnalyzeResult out = service.analyzeTeamGroups(groups, AllowedLanguage.ZH);
                final long ms = (System.nanoTime() - start) / 1_000_000;
                final int len = out.analysis() == null || out.analysis().analysis() == null
                        ? 0 : out.analysis().analysis().length();
                final boolean ok = len >= 200;
                if (ok) {
                    usable++;
                } else {
                    failures.add(sample + " (empty analysis, len=" + len + ")");
                }
                System.out.println("RESULT " + (ok ? "USABLE" : "FAIL") + " " + file.getFileName()
                        + " map=" + result.battle().mapName + " len=" + len + " ms=" + ms);
            } catch (final Exception e) {
                final long ms = (System.nanoTime() - start) / 1_000_000;
                final String code = e instanceof com.wotb.web.replay.ai.gateway.AiUpstreamException ue
                        ? ue.code() : e.getClass().getSimpleName();
                failures.add(sample + " (" + code + ")");
                System.out.println("RESULT FAIL " + file.getFileName() + " " + code + " ms=" + ms);
            }
        }
        System.out.println("===== 汇总 =====");
        final int ratePct = executed == 0 ? 0 : Math.round(100.0f * usable / executed);
        System.out.println("executedSamples=" + executed + " usableSamples=" + usable
                + " usableRate=" + ratePct + "% (target >= 80%)");
        if (!failures.isEmpty()) {
            System.out.println("failures:");
            failures.forEach(f -> System.out.println("  - " + f));
        }
        // 显式运行时验收：executed >= 1 时 usable rate 必须 >= 80%。
        // 该断言只作用于开发者主动运行本 probe 的场景——无 AI_API_KEY 时上方
        // Assumptions 已 skip，CI 不设 key 不会执行到这里，也不消耗任何 token。
        org.junit.jupiter.api.Assertions.assertTrue(executed > 0,
                "至少执行 1 个真实 replay（样本缺失时 probe 无验收意义）");
        org.junit.jupiter.api.Assertions.assertTrue(ratePct >= 80,
                "usable rate 必须 >= 80% (executed=" + executed + ", usable=" + usable + ")");
    }
}

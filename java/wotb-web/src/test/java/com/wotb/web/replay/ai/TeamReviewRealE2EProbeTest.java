package com.wotb.web.replay.ai;

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
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * 真实 DeepSeek E2E 探针（手动运行，不进 CI）：对真实 team replay 走 production 编排
 * （Call #1 + Team Call #2 validator retry loop + Autopsy），记录每个 validation attempt
 * 的 parse/validation 结果与冲突。
 * <p>必须设置环境变量 AI_API_KEY（临时 key，不在仓库出现）。</p>
 * Run: {@code mvn -pl wotb-web -am test -Dtest=TeamReviewRealE2EProbeTest -Dprobe.replay=<file>}
 */
class TeamReviewRealE2EProbeTest {

    @Test
    void realE2E() throws Exception {
        final String apiKey = System.getenv("AI_API_KEY");
        Assumptions.assumeTrue(apiKey != null && !apiKey.isBlank(), "AI_API_KEY env missing");
        String path = System.getProperty("probe.replay");
        if (path == null) {
            path = "data/probe-local/neptune1.wotbreplay";
        }
        final Path file = Path.of(path);
        Assumptions.assumeTrue(Files.exists(file), "sample missing: " + file);
        final byte[] bytes = Files.readAllBytes(file);
        final ReplayProcessingResult result = new DefaultReplayProcessingFacade()
                .process(new Source(file.getFileName().toString(), bytes), ReplayProcessingOptions.full());
        Assumptions.assumeTrue(result.battle() != null && result.battle().players != null, "no battle parsed");
        final List<ReplayPerspectiveGroup> groups = new BatchAnalyzer().analyze(List.of(result)).groups();
        Assumptions.assumeTrue(!groups.isEmpty(), "no team group");

        final AiModelProperties props = new AiModelProperties(
                apiKey, "https://api.deepseek.com", "deepseek-v4-flash",
                10, 120, 200, 1, 1000, 8000, 2.0,
                1_000_000, 940_000, 32768, 16384,
                false, "max", false, 4096);
        final SpringAiChatGateway gateway = SpringAiChatGateway.fromProperties(props, null);
        final AiReplayAnalysisConfig config = new AiReplayAnalysisConfig(
                new com.wotb.core.ai.ConservativeDeepSeekTokenEstimator(),
                "deepseek-v4-flash", 940_000, 1_000_000, 32768, 16384,
                false, "max", 200, 4096);
        final TeamReplayAnalysisService service = new TeamReplayAnalysisService(
                gateway, config,
                new PreBattleStrategicService(gateway, config, null),
                new TeamAutopsyService(gateway, config, null),
                System::nanoTime, null);

        System.out.println("===== 真实 E2E: " + file.getFileName());
        System.out.println("map=" + result.battle().mapName + " arenaBonusType=" + result.battle().arenaBonusType
                + " groups=" + groups.size());
        final long start = System.nanoTime();
        try {
            final TeamAnalyzeResult out = service.analyzeTeamGroups(groups, AllowedLanguage.ZH);
            final long ms = (System.nanoTime() - start) / 1_000_000;
            System.out.println("===== E2E SUCCESS in " + ms + "ms");
            System.out.println("preBattleSection=" + (out.preBattleSection() == null ? "null" : out.preBattleSection().length() + " chars"));
            final String analysis = out.analysis() == null || out.analysis().analysis() == null
                    ? "" : out.analysis().analysis();
            System.out.println("analysis length=" + analysis.length());
            System.out.println("analysis head=\n" + analysis.substring(0, Math.min(800, analysis.length())));
        } catch (final Exception e) {
            final long ms = (System.nanoTime() - start) / 1_000_000;
            System.out.println("===== E2E FAILED in " + ms + "ms: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            if (e instanceof com.wotb.web.replay.ai.gateway.AiUpstreamException ue) {
                System.out.println("code=" + ue.code() + " providerStatus=" + ue.providerStatus()
                        + " correlationId=" + ue.correlationId());
            }
            e.printStackTrace(System.out);
        }
    }
}

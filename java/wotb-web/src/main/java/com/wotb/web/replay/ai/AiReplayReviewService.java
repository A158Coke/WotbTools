package com.wotb.web.replay.ai;

import com.wotb.core.model.Source;
import com.wotb.core.processing.AiNotConfiguredException;
import com.wotb.core.processing.BatchAnalyzer;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.PerspectiveTeamNotResolvedException;
import com.wotb.core.processing.ReplayAnalysisScope;
import com.wotb.core.processing.ReplayPerspectiveGroup;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.processing.TeamPerspectiveResolver;
import com.wotb.core.processing.UnsupportedReplayAnalysisModeException;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.web.replay.metrics.ReplayUsageMetrics;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import com.wotb.web.replay.dto.AnalyzeResponse;
import com.wotb.web.replay.exception.AiPromptBudgetExceededException;
import com.wotb.web.replay.exception.ReplayFileCountExceededException;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.Locale;

@Service
public class AiReplayReviewService {

    private static final Logger LOGGER = LoggerFactory.getLogger(AiReplayReviewService.class);

    private final DefaultReplayProcessingFacade processingFacade;
    private final AiReplayAnalysisService aiAnalysisService;
    private final TacticalReviewHarness tacticalReviewHarness;

    @Autowired(required = false)
    private MeterRegistry meterRegistry;

    @Autowired(required = false)
    private ReplayUsageMetrics replayUsageMetrics;

    private final AtomicInteger aiReviewInFlight = new AtomicInteger();
    private Timer aiReviewDuration;
    private static final long MAX_FILE_SIZE = 20L * 1024 * 1024;
    private static final long MAX_TOTAL_SIZE = 200L * 1024 * 1024;

    public AiReplayReviewService(
            final DefaultReplayProcessingFacade processingFacade,
            final AiReplayAnalysisService aiAnalysisService) {
        this(processingFacade, aiAnalysisService, null);
    }

    @Autowired
    public AiReplayReviewService(
            final DefaultReplayProcessingFacade processingFacade,
            final AiReplayAnalysisService aiAnalysisService,
            final TacticalReviewHarness tacticalReviewHarness) {
        this.processingFacade = processingFacade;
        this.aiAnalysisService = aiAnalysisService;
        this.tacticalReviewHarness = tacticalReviewHarness;
    }

    private void validateBatchSize(final int fileCount) {
        if (fileCount > AiReplayBatchPolicy.MAX_FILES) {
            throw new ReplayFileCountExceededException(AiReplayBatchPolicy.MAX_FILES, fileCount);
        }
    }

    public AnalyzeResponse analyze(final MultipartFile[] files) throws IOException {
        return analyze(files, AllowedLanguage.ZH);
    }

    public AnalyzeResponse analyze(final MultipartFile[] files,
                                   final AllowedLanguage language) throws IOException {
        return analyzeStreaming(files, language, AiReviewStreamListener.NOOP);
    }

    /**
     * 流式变体：与 {@link #analyze(MultipartFile[], AllowedLanguage)} 完全相同的
     * 校验/指标/异常语义，额外通过 {@code listener} 广播阶段事件与主复盘 token
     * 增量。同步路径委托本方法（NOOP listener），保证单一实现不回归。
     */
    public AnalyzeResponse analyzeStreaming(final MultipartFile[] files,
                                            final AllowedLanguage language,
                                            final AiReviewStreamListener listener)
            throws IOException {
        final boolean metrics = meterRegistry != null;
        final Timer.Sample sample = metrics ? Timer.start(meterRegistry) : null;
        if (metrics) {
            aiReviewInFlight.incrementAndGet();
            meterRegistry.counter("wotb_ai_review_requests_total").increment();
        }
        String result = "success";
        String errorType = null;
        try {
            return analyzeInternal(files, language, listener);
        } catch (final AiNotConfiguredException e) {
            result = "rejected";
            errorType = "AI_NOT_CONFIGURED";
            throw e;
        } catch (final AiPromptBudgetExceededException e) {
            result = "rejected";
            errorType = "AI_PROMPT_BUDGET_EXCEEDED";
            throw e;
        } catch (final UnsupportedReplayAnalysisModeException e) {
            result = "rejected";
            errorType = "UNSUPPORTED_BATTLE_CATEGORY";
            throw e;
        } catch (final PerspectiveTeamNotResolvedException e) {
            result = "rejected";
            errorType = "PERSPECTIVE_TEAM_UNRESOLVED";
            throw e;
        } catch (final ReplayFileCountExceededException e) {
            result = "rejected";
            errorType = "REPLAY_FILE_COUNT_EXCEEDED";
            throw e;
        } catch (final IllegalArgumentException e) {
            // 文件校验 / NO_BATTLE_DATA / token budget 拒绝：均计入 rejected
            result = "rejected";
            throw e;
        } catch (final AiUpstreamException e) {
            result = "failure";
            errorType = e.code();
            throw e;
        } catch (final RuntimeException e) {
            // 未列出的运行时异常：计入 failure，避免虚增 success
            result = "failure";
            throw e;
        } catch (final IOException e) {
            result = "failure";
            throw e;
        } finally {
            if (metrics) {
                if (sample != null) {
                    sample.stop(aiReviewDuration);
                }
                aiReviewInFlight.decrementAndGet();
                meterRegistry.counter("wotb_ai_review_results_total",
                        "result", result).increment();
                if (errorType != null) {
                    meterRegistry.counter("wotb_ai_review_errors_total",
                            "type", errorType).increment();
                }
            }
        }
    }

    private AnalyzeResponse analyzeInternal(final MultipartFile[] files,
                                            final AllowedLanguage language,
                                            final AiReviewStreamListener listener) throws IOException {
        if (files == null || files.length == 0) throw new IllegalArgumentException("NO_REPLAY_FILES");
        validateBatchSize(files.length);
        long totalSize = 0;
        for (int i = 0; i < files.length; i++) {
            final MultipartFile file = files[i];
            if (file == null) throw new IllegalArgumentException("NO_REPLAY_FILE");
            final String name = file.getOriginalFilename();
            if (!StringUtils.hasText(name) || !name.toLowerCase(Locale.ROOT).endsWith(".wotbreplay")) {
                throw new IllegalArgumentException("INVALID_REPLAY_FILE_TYPE");
            }
            if (file.isEmpty()) throw new IllegalArgumentException("NO_REPLAY_FILE");
            final long fileSize = file.getSize();
            if (fileSize > MAX_FILE_SIZE) throw new IllegalArgumentException("FILE_TOO_LARGE");
            if (fileSize > MAX_TOTAL_SIZE - totalSize) throw new IllegalArgumentException("TOTAL_REQUEST_TOO_LARGE");
            totalSize += fileSize;
        }
        final List<ReplayProcessingResult> allResults = new ArrayList<>();
        for (int index = 0; index < files.length; index++) {
            final MultipartFile file = files[index];
            final String name = file.getOriginalFilename() != null
                    ? file.getOriginalFilename() : "replay.wotbreplay";
            final Source source = new Source(name, file.getBytes());
            if (replayUsageMetrics == null) {
                allResults.add(processingFacade.process(source, ReplayProcessingOptions.full()));
            } else {
                try {
                    allResults.add(replayUsageMetrics.timed(
                            ReplayUsageMetrics.OP_AI_REVIEW, 1,
                            () -> processingFacade.process(source, ReplayProcessingOptions.full())));
                } catch (final RuntimeException e) {
                    throw e;
                } catch (final Exception e) {
                    // process 不抛 checked；此处仅防御性包装
                    throw new IOException(e);
                }
            }
        }
        for (final ReplayProcessingResult r : allResults) {
            if (r.reconstruction() != null && r.reconstruction().coverage() != null) {
                final ReplayCoverage cov = r.reconstruction().coverage();
                LOGGER.info("Replay event-stream parsed: file={} map={} packets={} decoded={} "
                                + "partial={} unknown={} failed={} decodedRatio={}",
                        r.fileName(),
                        r.battle() != null ? r.battle().mapName : null,
                        cov.totalPackets(),
                        cov.decodedPackets(),
                        cov.partiallyDecodedPackets(),
                        cov.unknownPackets(),
                        cov.failedPackets(),
                        String.format(Locale.ROOT, "%.3f", cov.decodedPacketRatio()));
            }
        }
        final BatchAnalyzer.AnalysisPlan plan = new BatchAnalyzer().analyze(allResults);
        final boolean hasParsedBattle = allResults.stream().anyMatch(r -> r.battle() != null);
        if (!hasParsedBattle) throw new IllegalArgumentException("NO_BATTLE_DATA");
        if (plan.dominantScope() == null) throw new UnsupportedReplayAnalysisModeException("UNSUPPORTED_BATTLE_CATEGORY");
        final var analyzableGroups = plan.groups().stream()
                .filter(g -> g.representative().capabilities() != null
                        && BatchAnalyzer.isAiAnalyzable(g.representative(), plan.dominantScope()))
                .toList();
        if (analyzableGroups.isEmpty()) {
            if (plan.dominantScope() == ReplayAnalysisScope.TEAM_PERSPECTIVE) {
                final boolean teamResolved = plan.groups().stream()
                        .map(ReplayPerspectiveGroup::representative)
                        .map(ReplayProcessingResult::capabilities)
                        .anyMatch(capabilities -> capabilities != null
                                && capabilities.perspectiveTeamResolved());
                if (teamResolved) {
                    throw new IllegalArgumentException("TEAM_FEATURES_UNAVAILABLE");
                }
                throw new PerspectiveTeamNotResolvedException(unresolvedTeamCode(plan.groups()));
            }
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        }
        return switch (plan.mode()) {
            case SINGLE_PLAYER_BATTLE -> {
                final TacticalReviewHarness.HarnessOutcome outcome = harnessOrFallback(
                        analyzableGroups.getFirst().representative(), language, listener);
                yield new AnalyzeResponse(
                        outcome.result().analysis(),
                        renderRandomBattleSection(
                                analyzableGroups.getFirst().representative(),
                                outcome.preBattlePrior(), language));
            }
            case MULTI_PLAYER_BATTLE -> {
                final var battles = analyzableGroups.stream()
                        .map(ReplayPerspectiveGroup::representative)
                        .map(ReplayProcessingResult::battle)
                        .toList();
                yield new AnalyzeResponse(
                        aiAnalysisService.analyzeMulti(battles, language, listener).analysis());
            }
            case SINGLE_TEAM_BATTLE, MULTI_TEAM_BATTLE -> {
                final TeamAnalyzeResult teamResult = aiAnalysisService
                        .analyzeTeamGroups(analyzableGroups, language, listener);
                yield new AnalyzeResponse(
                        teamResult.analysis().analysis(),
                        teamResult.preBattleSection());
            }
            case NONE -> throw new IllegalArgumentException("NO_BATTLE_DATA");
        };
    }

    private TacticalReviewHarness.HarnessOutcome harnessOrFallback(
            final ReplayProcessingResult representative,
            final AllowedLanguage language,
            final AiReviewStreamListener listener) {
        if (tacticalReviewHarness != null) {
            return tacticalReviewHarness.analyzeWithPrior(representative, language, listener);
        }
        return new TacticalReviewHarness.HarnessOutcome(
                aiAnalysisService.analyzePlayerOrFallback(representative, language, listener), null);
    }

    /**
     * 随机战 Call #1 prior 的用户可见渲染：按录像者 perspective 队伍映射为
     * 「友军/敌军」——录像者所属 team → 友军，另一方 → 敌军。Call #1 内部保持
     * TEAM_A/TEAM_B 客观标签不受影响（只有用户 UI 渲染做映射），随机战用户界面
     * 不允许出现「队伍1/队伍2」。录像者 team 无法确定时走中性防御路径。
     */
    private static String renderRandomBattleSection(
            final ReplayProcessingResult representative,
            final PreBattleStrategicPrior prior,
            final AllowedLanguage language) {
        if (prior == null) {
            return null;
        }
        final RecorderEntityMapping recorder = AnalysisUnitAssembler.findRecorder(representative);
        final int recorderTeam = recorder != null && recorder.team() != null
                ? recorder.team() : 0;
        final String recorderName = recorder != null ? recorder.nickname() : null;
        return PreBattleSectionRenderer.renderRandomBattle(
                prior, recorderTeam, recorderName, language);
    }

    private static String unresolvedTeamCode(final List<ReplayPerspectiveGroup> groups) {
        final boolean conflict = groups.stream()
                .map(ReplayPerspectiveGroup::representative)
                .map(result -> TeamPerspectiveResolver.resolve(
                        result.battle(), result.reconstruction()))
                .anyMatch(resolution -> resolution.limitations().stream()
                        .anyMatch(code -> "PERSPECTIVE_TEAM_CONFLICT".equals(code)
                                || "RECORDER_IDENTITY_CONFLICT".equals(code)));
        return conflict ? "PERSPECTIVE_TEAM_CONFLICT" : "PERSPECTIVE_TEAM_UNRESOLVED";
    }

    /**
     * 初始化 AI Review 边界指标（仅当 MeterRegistry 可用时；单元测试中为 null 则跳过）。
     */
    @PostConstruct
    void initMetrics() {
        if (meterRegistry == null) {
            return;
        }
        aiReviewDuration = Timer.builder("wotb_ai_review_duration_seconds")
                .description("AI Review 完整总耗时")
                .publishPercentileHistogram()
                .register(meterRegistry);
        Gauge.builder("wotb_ai_review_in_flight", aiReviewInFlight, AtomicInteger::get)
                .description("当前正在处理的 AI Review 请求数")
                .register(meterRegistry);
    }
}

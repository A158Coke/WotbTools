package com.wotb.web.replay.ai;

import com.wotb.core.ai.ClusterTermSanitizer;
import com.wotb.core.ai.TankNameCorrector;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.processing.AiNotConfiguredException;
import com.wotb.core.processing.BatchAnalyzer;
import com.wotb.core.processing.DefaultReplayProcessingFacade;
import com.wotb.core.processing.PerspectiveTeamNotResolvedException;
import com.wotb.core.processing.PlayerSideResolver;
import com.wotb.core.processing.ReplayAnalysisScope;
import com.wotb.core.processing.ReplayPerspectiveGroup;
import com.wotb.core.processing.ReplayProcessingOptions;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.processing.TeamPerspectiveResolver;
import com.wotb.core.processing.UnsupportedReplayAnalysisModeException;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.ref.ReplayDisplayNames;
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
import com.wotb.web.replay.ReplayUploadValidator;
import com.wotb.web.replay.exception.ReplayFileCountExceededException;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.Locale;
import java.util.stream.Collectors;

@Service
public class AiReplayReviewService {

    private static final Logger LOGGER = LoggerFactory.getLogger(AiReplayReviewService.class);

    private final DefaultReplayProcessingFacade processingFacade;
    private final AiReplayAnalysisService aiAnalysisService;
    private final TacticalReviewHarness tacticalReviewHarness;
    private final MeterRegistry meterRegistry;
    private final ReplayUsageMetrics replayUsageMetrics;

    private final AtomicInteger aiReviewInFlight = new AtomicInteger();
    private Timer aiReviewDuration;
    public AiReplayReviewService(
            final DefaultReplayProcessingFacade processingFacade,
            final AiReplayAnalysisService aiAnalysisService) {
        this(processingFacade, aiAnalysisService, null, null, null);
    }

    @Autowired
    public AiReplayReviewService(
            final DefaultReplayProcessingFacade processingFacade,
            final AiReplayAnalysisService aiAnalysisService,
            final TacticalReviewHarness tacticalReviewHarness,
            @Autowired(required = false) final MeterRegistry meterRegistry,
            @Autowired(required = false) final ReplayUsageMetrics replayUsageMetrics) {
        this.processingFacade = processingFacade;
        this.aiAnalysisService = aiAnalysisService;
        this.tacticalReviewHarness = tacticalReviewHarness;
        this.meterRegistry = meterRegistry;
        this.replayUsageMetrics = replayUsageMetrics;
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
        ReplayUploadValidator.validateAiReview(files);
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
                final ReplayProcessingResult representative =
                        analyzableGroups.getFirst().representative();
                final TacticalReviewHarness.HarnessOutcome outcome = harnessOrFallback(
                        representative, language, listener);
                final Battle battle = representative.battle();
                final List<String> corrected = sanitizeClusterTerms(correctTankNames(packageSections(
                        outcome.result().analysis(),
                        renderRandomBattleSection(representative, outcome.preBattlePrior(), language)),
                        battle), battle);
                yield new AnalyzeResponse(
                        withDisclaimerFooter(corrected.get(0), language),
                        corrected.get(1),
                        MapOverviewBuilder.build(battle, representative.reconstruction()));
            }
            case SINGLE_TEAM_BATTLE -> {
                final TeamAnalyzeResult teamResult = aiAnalysisService
                        .analyzeTeamGroups(analyzableGroups, language, listener);
                final ReplayProcessingResult first = analyzableGroups.getFirst().representative();
                final Battle battle = first.battle();
                final List<String> corrected = sanitizeClusterTerms(correctTankNames(packageSections(
                        teamResult.analysis().analysis(), teamResult.preBattleSection()), battle), battle);
                yield new AnalyzeResponse(
                        withDisclaimerFooter(corrected.get(0), language),
                        corrected.get(1),
                        MapOverviewBuilder.build(battle, first.reconstruction()));
            }
            case NONE -> throw new IllegalArgumentException("NO_BATTLE_DATA");
            default -> throw new UnsupportedReplayAnalysisModeException("UNSUPPORTED_BATTLE_CATEGORY");
        };
    }

    /**
     * 坦克名称确定性校验/纠正：把同一 AI Review 的多个文本（analysis + preBattleSection）
     * 视为一个 correction package，跨文本共享昵称锚点已证明的传播映射后再逐文本纠正
     * （见 {@link TankNameCorrector#correctAll(List, Collection)}）。
     * 只做文本级纠正，不改任何解析/结算数据；有处理明细时记日志（含 R3 独立检测）。
     * null 输入段原样返回 null；返回列表与输入一一对应。
     */
    private static List<String> correctTankNames(final List<String> texts, final Battle battle) {
        if (texts == null || texts.isEmpty()
                || battle == null || battle.players == null || battle.players.isEmpty()) {
            return texts;
        }
        final List<TankNameCorrector.RosterEntry> roster = battle.players.stream()
                .filter(p -> PlayerSideResolver.isValidRawTeam(p.team))
                .filter(p -> p.tankId > 0)
                .map(p -> new TankNameCorrector.RosterEntry(
                        p.nickname == null ? "" : p.nickname,
                        ReplayDisplayNames.tankName(p.tankId, p.tankName)))
                .toList();
        if (roster.isEmpty()) {
            return texts;
        }
        final List<TankNameCorrector.Result> results = TankNameCorrector.correctAll(texts, roster);
        final List<String> corrected = new ArrayList<>(texts.size());
        for (int i = 0; i < texts.size(); i++) {
            corrected.add(texts.get(i) == null ? null : results.get(i).text());
        }
        final String detail = results.stream()
                .flatMap(r -> r.replacements().stream())
                .map(r -> r.original() + " -> " + r.replacement() + "[" + r.reason() + "]")
                .collect(Collectors.joining("; "));
        if (!detail.isEmpty()) {
            LOGGER.info("AI tank-name correction applied: {}", detail);
        }
        return corrected;
    }

    /**
     * 「簇」字确定性兜底（{@link ClusterTermSanitizer}）：对 correction package 各段统一应用，
     * 消除 AI 生成的内部术语「簇」；同时保护权威 proper noun（roster 昵称 / 权威坦克名，
     * 可能合法含「簇」）原样保留。null 段原样保留。
     */
    static List<String> sanitizeClusterTerms(final List<String> texts, final Battle battle) {
        final List<String> protectedLiterals = new ArrayList<>();
        if (battle != null && battle.players != null) {
            for (final PlayerResult p : battle.players) {
                if (p == null) {
                    continue;
                }
                if (p.nickname != null && !p.nickname.isBlank()) {
                    protectedLiterals.add(p.nickname);
                }
                final String tankName = ReplayDisplayNames.tankName(p.tankId, p.tankName);
                if (tankName != null && !tankName.isBlank()) {
                    protectedLiterals.add(tankName);
                }
            }
        }
        final List<String> out = new ArrayList<>(texts.size());
        for (final String t : texts) {
            out.add(t == null ? null : ClusterTermSanitizer.sanitize(t, protectedLiterals));
        }
        return out;
    }

    /** 组装 correction package 的各段（允许 null 元素，null 段原样保留）。 */
    private static List<String> packageSections(final String analysis, final String preBattleSection) {
        final List<String> sections = new ArrayList<>(2);
        sections.add(analysis);
        sections.add(preBattleSection);
        return sections;
    }

    /** 复盘固定结尾免责句（三语），追加在 analysis 末尾。 */
    private static String withDisclaimerFooter(final String analysis, final AllowedLanguage language) {
        if (analysis == null || analysis.isBlank()) {
            return analysis;
        }
        final String footer = switch (language == null ? AllowedLanguage.ZH : language) {
            case ZH -> "\n\nAI复盘仅供参考";
            case EN -> "\n\nThis AI review is for reference only";
            case RU -> "\n\nРазбор ИИ приведён только для справки";
        };
        return analysis + footer;
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
     * <p>随机战 <b>不</b>把录像者 nickname 作为 team label（避免「友军（Player123）
     * 画像」），只显示「友军画像/敌军画像」；团队复盘保留真实 clan/team label。</p>
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
        return PreBattleSectionRenderer.renderRandomBattle(
                prior, recorderTeam, language,
                representative.battle() == null ? null : representative.battle().mapName);
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

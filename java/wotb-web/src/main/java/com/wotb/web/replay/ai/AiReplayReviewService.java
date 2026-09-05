package com.wotb.web.replay.ai;

import com.wotb.core.ai.ClusterTermSanitizer;
import com.wotb.core.ai.TankNameCorrector;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.facts.AiReplayFacts;
import com.wotb.core.replay.processing.AiNotConfiguredException;
import com.wotb.core.replay.processing.BattleCategoryUtils;
import com.wotb.core.replay.processing.BattleGroupingKey;
import com.wotb.core.replay.processing.PerspectiveTeamNotResolvedException;
import com.wotb.core.replay.processing.PlayerSideResolver;
import com.wotb.core.replay.processing.RecorderEntityMapping;
import com.wotb.core.replay.processing.ReplayAnalysisScope;
import com.wotb.core.replay.processing.ReplayPerspectiveGroup;
import com.wotb.core.replay.processing.ReplayPerspectiveGroupKey;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.processing.TeamPerspectiveResolution;
import com.wotb.core.replay.processing.TeamPerspectiveResolver;
import com.wotb.core.replay.processing.UnsupportedBattleCategoryException;
import com.wotb.core.replay.processing.UnsupportedReplayAnalysisModeException;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.web.replay.ai.gateway.AiUpstreamException;
import com.wotb.web.replay.dto.AnalyzeResponse;
import com.wotb.web.replay.exception.AiPromptBudgetExceededException;
import com.wotb.web.replay.exception.AiTimelineUnusableException;
import com.wotb.web.replay.job.ReplayArtifactWriter;
import com.wotb.web.replay.job.ReplayProcessingJob;
import com.wotb.web.replay.job.ReplayProcessingJobStore;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

@Service
public class AiReplayReviewService {

    private static final Logger LOGGER = LoggerFactory.getLogger(AiReplayReviewService.class);

    private final AiReplayAnalysisService aiAnalysisService;
    private final TacticalReviewHarness tacticalReviewHarness;
    private final MeterRegistry meterRegistry;
    /** Dataset Lease 提供方：AI 读取 derived artifact 前 acquire，防止 TTL 清理。 */
    private final ReplayProcessingJobStore processingStore;

    private final AtomicInteger aiReviewInFlight = new AtomicInteger();
    private Timer aiReviewDuration;
    public AiReplayReviewService(
            final AiReplayAnalysisService aiAnalysisService,
            final TacticalReviewHarness tacticalReviewHarness,
            @Autowired(required = false) final MeterRegistry meterRegistry,
            final ReplayProcessingJobStore processingStore) {
        this.aiAnalysisService = aiAnalysisService;
        this.tacticalReviewHarness = tacticalReviewHarness;
        this.meterRegistry = meterRegistry;
        this.processingStore = processingStore;
    }

    /**
     * Dataset 路径：从 Processing Job 的 derived artifact 读取
     * {@link AiReplayFacts} 并执行同一 AI 链路；<b>不</b>重新上传 / 不重新 full
     * process。source 未 READY / job 不存在返回稳定错误码。
     */
    public AnalyzeResponse analyzeFacts(final String processingJobId, final int sourceIndex,
                                        final AllowedLanguage language,
                                        final AiReviewStreamListener listener) throws IOException {
        requireDatasetReference(processingJobId, sourceIndex);
        final ReplayProcessingJob job = processingStore.acquireForSource(processingJobId);
        if (job == null) {
            datasetCache("ai", false);
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "JOB_NOT_FOUND");
        }
        try {
            final ReplayProcessingJob.Snapshot snap = job.snapshot();
            if (sourceIndex < 0 || sourceIndex >= snap.sources().size()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SOURCE_NOT_FOUND");
            }
            final ReplayProcessingJob.SourceState state = snap.sources().get(sourceIndex);
            if (state.status() != ReplayProcessingJob.SourceStatus.READY) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        state.status() == ReplayProcessingJob.SourceStatus.FAILED
                                ? "SOURCE_PROCESSING_FAILED" : "SOURCE_NOT_READY");
            }
            final AiReplayFacts facts =
                    ReplayArtifactWriter.readAiFacts(processingStore.jobDir(processingJobId), sourceIndex);
            datasetCache("ai", true);
            return analyzeFacts(facts, language, listener);
        } catch (final java.io.IOException | tools.jackson.core.JacksonException e) {
            datasetCache("ai", false);
            // artifact 读取 / 解码 / 存储 I/O 故障（含 ai-facts.json 缺失、corrupt
            // JSON、permission / disk error）。这些<b>不是</b>「job 不存在」——映射为不可恢复的
            // 503 DATASET_UNAVAILABLE（否则前端会误触发 exactly-once full-process recovery，
            // 浪费 CPU 并掩盖真实存储故障）。job 缺失 / source 缺失 / source 未 READY 各自有
            // 专门的稳定码（JOB_NOT_FOUND / SOURCE_NOT_FOUND / SOURCE_NOT_READY·SOURCE_PROCESSING_FAILED）。
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "DATASET_UNAVAILABLE");
        } finally {
            processingStore.release(processingJobId);
        }
    }

    /** 缺失/空引用 → 400（杜绝 null processingJobId 进入 store 查找 NPE → 500）。 */
    private static void requireDatasetReference(final String processingJobId, final int sourceIndex) {
        if (processingJobId == null || processingJobId.isBlank() || sourceIndex < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "DATASET_REFERENCE_REQUIRED");
        }
    }

    private void datasetCache(final String consumer, final boolean hit) {
        if (meterRegistry == null) {
            return;
        }
        meterRegistry.counter("wotb_replay_dataset_cache_"
                + (hit ? "hits" : "misses") + "_total", "consumer", consumer).increment();
    }

    /** 对 Dataset 还原的 ai-facts 执行 authoritative AI 链路（无第二条 old analyze 生产路径）。 */
    public AnalyzeResponse analyzeFacts(final AiReplayFacts facts,
                                        final AllowedLanguage language,
                                        final AiReviewStreamListener listener) {
        final AnalyzeResponse base = analyzeTracked(language, listener,
                () -> analyzeResults(facts.toResult(), language, listener));
        // capability 是 additive 元数据：与 prompt planner 的 battleStart 判定一致，
        // 不改变 AI 生成逻辑，仅向客户端表达「完整 / 受限时间轴」降级态。
        return base == null
                ? new AnalyzeResponse(null, null, capabilityOf(facts), null)
                : new AnalyzeResponse(base.analysis(), base.preBattleSection(), capabilityOf(facts),
                        base.teamReview());
    }

    /**
     * AI Review capability 派生（与 {@link com.wotb.core.ai.SingleReplayPromptPlanner}
     * 的 battleStartRawClockSec 可用性判定保持一致）；UNAVAILABLE 由 ai-facts/recon 缺失表达。
     */
    private static AnalyzeResponse.Capability capabilityOf(final AiReplayFacts facts) {
        if (facts == null) {
            return AnalyzeResponse.Capability.UNAVAILABLE;
        }
        final com.wotb.core.replay.reconstruction.ReplayReconstruction recon = facts.reconstruction();
        if (recon == null) {
            return AnalyzeResponse.Capability.UNAVAILABLE;
        }
        final Float start = recon.battleStartRawClockSec();
        final boolean available = start != null && Float.isFinite(start) && start > 0f;
        return available
                ? AnalyzeResponse.Capability.AVAILABLE
                : AnalyzeResponse.Capability.AVAILABLE_WITH_LIMITED_TIMELINE;
    }

    /**
     * AI Review 边界指标信封（V2 收口后挂在 Dataset 共享路径，不得因 multipart
     * 删除而丢失 observability）：请求计数 / in-flight gauge / 耗时 / 结果类别 /
     * 稳定错误码（低基数）。异常语义与异常本身完全一致，只增加记账。
     */
    private AnalyzeResponse analyzeTracked(final AllowedLanguage language,
                                           final AiReviewStreamListener listener,
                                           final java.util.function.Supplier<AnalyzeResponse> body) {
        final boolean metrics = meterRegistry != null;
        final Timer.Sample sample = metrics ? Timer.start(meterRegistry) : null;
        if (metrics) {
            aiReviewInFlight.incrementAndGet();
            meterRegistry.counter("wotb_ai_review_requests_total").increment();
        }
        String result = "success";
        String errorType = null;
        try {
            return body.get();
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
        } catch (final AiTimelineUnusableException e) {
            result = "rejected";
            errorType = AiTimelineUnusableException.STABLE_ERROR_CODE;
            throw e;
        } catch (final IllegalArgumentException e) {
            result = "rejected";
            throw e;
        } catch (final AiUpstreamException e) {
            result = "failure";
            errorType = e.code();
            throw e;
        } catch (final RuntimeException e) {
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

    /**
     * Dataset-derived {@link ReplayProcessingResult}（单文件 {@code facts.toResult()}）的 AI 编排：
     * coverage 日志 → 模式判定 → 可分析分组 → 单场/团队分支。
     */
    private AnalyzeResponse analyzeResults(final ReplayProcessingResult result,
                                           final AllowedLanguage language,
                                           final AiReviewStreamListener listener) {
        if (result.reconstruction() != null && result.reconstruction().coverage() != null) {
            final ReplayCoverage cov = result.reconstruction().coverage();
            LOGGER.info("Replay event-stream parsed: file={} map={} packets={} decoded={} "
                            + "partial={} unknown={} failed={} decodedRatio={}",
                    result.fileName(),
                    result.battle() != null ? result.battle().mapName : null,
                    cov.totalPackets(),
                    cov.decodedPackets(),
                    cov.partiallyDecodedPackets(),
                    cov.unknownPackets(),
                    cov.failedPackets(),
                    String.format(Locale.ROOT, "%.3f", cov.decodedPacketRatio()));
        }
        if (result.battle() == null) throw new IllegalArgumentException("NO_BATTLE_DATA");
        final ReplayAnalysisScope scope;
        try {
            scope = BattleCategoryUtils.resolveScope(
                    BattleCategoryUtils.fromArenaBonusType(result.battle().arenaBonusType));
        } catch (UnsupportedBattleCategoryException e) {
            throw new UnsupportedReplayAnalysisModeException("UNSUPPORTED_BATTLE_CATEGORY");
        }

        // AI review is single-source / single-analyzable-unit: build the one perspective group and
        // dispatch directly instead of routing List.of(result) through BatchAnalyzer grouping.
        final TeamPerspectiveResolution teamResolution = TeamPerspectiveResolver.resolve(
                result.battle(), result.reconstruction());
        final int perspectiveTeam = teamResolution.resolved() ? teamResolution.perspectiveTeam() : 0;
        final ReplayPerspectiveGroup group = singleGroup(result, perspectiveTeam);

        if (!(result.capabilities() != null && result.capabilities().aiAnalyzable(scope))) {
            if (scope == ReplayAnalysisScope.TEAM_PERSPECTIVE) {
                if (result.capabilities() != null && result.capabilities().perspectiveTeamResolved()) {
                    throw new IllegalArgumentException("TEAM_FEATURES_UNAVAILABLE");
                }
                throw new PerspectiveTeamNotResolvedException(unresolvedTeamCode(List.of(group)));
            }
            throw new IllegalArgumentException("NO_BATTLE_DATA");
        }
        return switch (scope) {
            case PLAYER_FOCUSED -> {
                final TacticalReviewHarness.HarnessOutcome outcome = harnessOrFallback(
                        result, language, listener);
                final Battle battle = result.battle();
                final List<String> corrected = sanitizeClusterTerms(correctTankNames(packageSections(
                        outcome.result().analysis(),
                        renderRandomBattleSection(result, outcome.preBattlePrior(), language)),
                        battle), battle);
                yield new AnalyzeResponse(
                        withDisclaimerFooter(corrected.get(0), language),
                        corrected.get(1));
            }
            case TEAM_PERSPECTIVE -> {
                final TeamAnalyzeResult teamResult = aiAnalysisService
                        .analyzeTeamGroups(List.of(group), language, listener);
                yield new AnalyzeResponse(
                        null,
                        teamResult.preBattleSection(),
                        AnalyzeResponse.Capability.AVAILABLE,
                        teamResult.structuredResult());
            }
        };
    }

    /** 单文件视角分组（AI 单源单可分析单元）：resolved=true 时 perspectiveTeam 为录像者队伍。 */
    private static ReplayPerspectiveGroup singleGroup(final ReplayProcessingResult result,
                                                      final int perspectiveTeam) {
        final ReplayPerspectiveGroupKey key = new ReplayPerspectiveGroupKey(
                BattleGroupingKey.from(result.identity(), result.battle(), result.fileName()),
                perspectiveTeam);
        return new ReplayPerspectiveGroup(key, key.battleKey().toBattleIdentity(), result, List.of());
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
                if (p.clan != null && !p.clan.isBlank()) {
                    // teamLabel（TeamPerspectiveLabelResolver 从 clan 聚合）可能含「簇」
                    protectedLiterals.add(p.clan);
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

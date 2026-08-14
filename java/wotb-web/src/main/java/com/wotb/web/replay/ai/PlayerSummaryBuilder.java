package com.wotb.web.replay.ai;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.EvidenceDensity;
import com.wotb.core.ai.PlannedPrompt;
import com.wotb.core.ai.SingleReplayPromptPlanner;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.FriendlyEnemyResult;
import com.wotb.core.processing.FriendlyEnemyResult.Winner;
import com.wotb.core.processing.PlayerSideResolver;
import com.wotb.core.processing.PlayerSideResolver.Side;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.KeyBattleEvent;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * Player 复盘 prompt 编排与摘要构建器。
 * <p>从 {@link PlayerReplayPromptBuilder} 拆出，职责：prepareFallback / prepareFullNoRecon /
 * prepareFull 三条入口、单场上下文摘要 {@link #buildPlayerContextSummary}、
 * 死亡时间线事件构建；证据渲染委托 {@link PlayerEvidenceFormatter}，
 * 规则/多语言来自 {@link PlayerPromptRules}。</p>
 * <p>纯静态工具类，不引入 Spring AI，不包含 API key 或 {@code Map<String,Object>} Provider 请求体。</p>
 */
final class PlayerSummaryBuilder {

    private PlayerSummaryBuilder() {
    }

    /**
     * Fallback 路径：基于结算数据 + 重建是否可用，产出一份系统/用户 prompt ready 的包。
     *
     * @param battle    权威结算
     * @param recon     完整重建（可为 null）
     * @return {@link PreparedAiPrompt}，analysisMode = {@code SINGLE_PLAYER_SUMMARY}
     */
    public static PreparedAiPrompt prepareFallback(final Battle battle,
                                                   final ReplayReconstruction recon) {
        return prepareFallback(battle, recon, AllowedLanguage.ZH);
    }

    public static PreparedAiPrompt prepareFallback(final Battle battle,
                                                   final ReplayReconstruction recon,
                                                   final AllowedLanguage language) {
        final List<KeyBattleEvent> keyEvents = buildDeathTimeline(battle);
        final String enemySection = EnemyLastKnownPositionsSection.renderPlayerSection(battle, recon);
        final String phaseSection = BattlePhaseTimelineSection.renderPlayerSection(
                buildFallbackPhases(battle),
                BattlePhaseSummary.deathSourceLabel(battle));
        // 点数局势：fallback 无覆盖口径信号，伤害数字抑制（定性）；recon 缺失时仅击杀夺分时间线
        final Integer recorderTeam = battle == null
                ? null : PlayerSideResolver.resolveRecorderTeam(battle);
        final String pointsSection = recorderTeam == null ? ""
                : PointsSituationEvidence.renderSection(
                        battle, recon, recorderTeam, true, "你的队伍", "敌方");
        final String summary = buildSummary(battle, recon, keyEvents)
                + (phaseSection.isEmpty() ? "" : "\n" + phaseSection)
                + (enemySection.isEmpty() ? "" : "\n" + enemySection)
                + (pointsSection.isEmpty() ? "" : "\n" + pointsSection);
        final String systemPrompt = PlayerPromptRules.localizePlayerSystemPrompt(PlayerPromptRules.SYSTEM_PROMPT, language);
        return new PreparedAiPrompt(systemPrompt, summary, "SINGLE_PLAYER_SUMMARY",
                EvidenceDensity.LEVEL_1_COMPRESSED, 0);
    }

    /**
     * Fallback 路径的阶段时间线：无事件流分析，首次接敌未知（-1），
     * 阶段边界只用 battle_results 的结束时刻 + 死亡时间线，人数来自权威结算。
     */
    private static List<BattlePhaseSummary> buildFallbackPhases(final Battle battle) {
        final float battleEnd = battle != null && battle.durationS != null
                ? battle.durationS.floatValue() : Float.NaN;
        return BattlePhaseSummary.buildRelativePhasesWithSurvival(
                BattlePhaseSummary.UNKNOWN_FIRST_CONTACT, battleEnd,
                BattlePhaseSummary.SurvivalTimeline.fromBattleResults(
                        battle, PlayerSideResolver.resolveRecorderTeam(battle)));
    }

    /**
     * 单回放完整特征路径（无重建时）：依据 ctx 预算控制证据密度后产出 prompt。
     */
    public static PreparedAiPrompt prepareFullNoRecon(
            final SinglePlayerBattleAnalysisContext ctx,
            final AiTokenEstimator estimator,
            final int maxInputTokens,
            final int contextWindowTokens,
            final int maxOutputTokens,
            final int promptSafetyMarginTokens) {
        return prepareFullNoRecon(ctx, estimator, maxInputTokens, contextWindowTokens,
                maxOutputTokens, promptSafetyMarginTokens, AllowedLanguage.ZH);
    }

    public static PreparedAiPrompt prepareFullNoRecon(
            final SinglePlayerBattleAnalysisContext ctx,
            final AiTokenEstimator estimator,
            final int maxInputTokens,
            final int contextWindowTokens,
            final int maxOutputTokens,
            final int promptSafetyMarginTokens,
            final AllowedLanguage language) {
        // 无重建路径：仅击杀夺分时间线（结算可证）；存在/推进窗口需重建，不输出
        final Integer recorderTeam = ctx.battle() == null
                ? null : PlayerSideResolver.resolveRecorderTeam(ctx.battle());
        final String pointsSection = recorderTeam == null ? ""
                : PointsSituationEvidence.renderSection(
                        ctx.battle(), null, recorderTeam, true, "你的队伍", "敌方");
        final String summary = buildPlayerContextSummary(ctx)
                + (pointsSection.isEmpty() ? "" : "\n" + pointsSection);
        final String systemPrompt = PlayerPromptRules.localizePlayerSystemPrompt(PlayerPromptRules.SINGLE_PLAYER_PROMPT, language);
        final List<Map<String, Object>> messages = List.of(
                Map.<String, Object>of("role", "system", "content", systemPrompt),
                Map.<String, Object>of("role", "user", "content", summary));
        final int estimatedTokens = estimator.estimateMessagesTokens(messages);
        AiPromptBudgetGuard.enforce(estimatedTokens, maxInputTokens, contextWindowTokens,
                maxOutputTokens, promptSafetyMarginTokens);
        return new PreparedAiPrompt(systemPrompt, summary, "SINGLE_PLAYER_BATTLE",
                EvidenceDensity.LEVEL_1_COMPRESSED, estimatedTokens);
    }

    /**
     * 单回放完整特征路径（含重建）：在基础摘要上追加逐对手对炮与逐次伤害事件，
     * 再交由 {@link SingleReplayPromptPlanner} 按 token 预算确定证据密度。
     */
    public static PreparedAiPrompt prepareFull(
            final SinglePlayerBattleAnalysisContext ctx,
            final ReplayReconstruction recon,
            final AiTokenEstimator estimator,
            final int maxInputTokens,
            final int contextWindowTokens,
            final int maxOutputTokens,
            final int promptSafetyMarginTokens) {
        return prepareFull(ctx, recon, estimator, maxInputTokens, contextWindowTokens,
                maxOutputTokens, promptSafetyMarginTokens, AllowedLanguage.ZH);
    }

    public static PreparedAiPrompt prepareFull(
            final SinglePlayerBattleAnalysisContext ctx,
            final ReplayReconstruction recon,
            final AiTokenEstimator estimator,
            final int maxInputTokens,
            final int contextWindowTokens,
            final int maxOutputTokens,
            final int promptSafetyMarginTokens,
            final AllowedLanguage language) {
        final long recorderAccountId = ctx.recorder() != null && ctx.recorder().accountId() != null
                ? ctx.recorder().accountId() : -1L;
        final StringBuilder summaryBuilder = new StringBuilder(buildPlayerContextSummary(ctx));
        // OBSERVED_DAMAGE_IS_PARTIAL 只计算一次：逐对手、逐炮、掉血窗口三段统一抑制，
        // 覆盖完整时三段正常输出（不一边输出数字一边声明已抑制）。
        final boolean observedDamagePartial = hasObservedDamagePartial(ctx);
        PlayerEvidenceFormatter.appendDamageExchangeByOpponent(
                summaryBuilder, ctx.battle(), recorderAccountId, recon, observedDamagePartial);
        if (!PlayerEvidenceFormatter.appendPerHitDamageEvents(
                summaryBuilder, ctx.battle(), recorderAccountId, recon, observedDamagePartial)) {
            summaryBuilder.append("- PER_HIT_DAMAGE_EVENTS_UNAVAILABLE\n");
        }
        PlayerEvidenceFormatter.appendRecorderDamageReceivedWindows(
                summaryBuilder, ctx.battle(), recon, recorderAccountId, observedDamagePartial);
        PlayerEvidenceFormatter.appendEnemyLastKnownPositions(summaryBuilder, ctx.battle(), recon);
        final Integer recorderTeam = ctx.battle() == null
                ? null : PlayerSideResolver.resolveRecorderTeam(ctx.battle());
        if (recorderTeam != null) {
            final String pointsSection = PointsSituationEvidence.renderSection(
                    ctx.battle(), recon, recorderTeam, observedDamagePartial,
                    "你的队伍", "敌方");
            if (!pointsSection.isEmpty()) {
                summaryBuilder.append(pointsSection);
            }
        }
        final String baseSummary = summaryBuilder.toString();
        final String systemPrompt = PlayerPromptRules.localizePlayerSystemPrompt(PlayerPromptRules.SINGLE_PLAYER_PROMPT, language);
        final SingleReplayPromptPlanner planner = new SingleReplayPromptPlanner(
                estimator, maxInputTokens,
                contextWindowTokens, maxOutputTokens, promptSafetyMarginTokens);
        final PlannedPrompt planned = planner.plan(
                systemPrompt, baseSummary, ctx, recon);
        final List<Map<String, Object>> messages = List.of(
                Map.<String, Object>of("role", "system", "content", systemPrompt),
                Map.<String, Object>of("role", "user", "content", planned.userContent()));
        final int estimatedTokens = estimator.estimateMessagesTokens(messages);
        AiPromptBudgetGuard.enforce(estimatedTokens, maxInputTokens, contextWindowTokens,
                maxOutputTokens, promptSafetyMarginTokens);
        return new PreparedAiPrompt(systemPrompt, planned.userContent(),
                "SINGLE_PLAYER_BATTLE", planned.density(), estimatedTokens);
    }

    /** Player 与 Team 一致的 OBSERVED_DAMAGE_IS_PARTIAL 抑制口径（上下文与特征集任一命中即抑制）。 */
    private static boolean hasObservedDamagePartial(final SinglePlayerBattleAnalysisContext ctx) {
        if (ctx.limitations() != null
                && ctx.limitations().contains("OBSERVED_DAMAGE_IS_PARTIAL")) {
            return true;
        }
        return ctx.features() != null && ctx.features().limitations() != null
                && ctx.features().limitations().contains("OBSERVED_DAMAGE_IS_PARTIAL");
    }

    public static String buildPlayerContextSummary(final SinglePlayerBattleAnalysisContext ctx) {
        final StringBuilder sb = new StringBuilder(4096);
        final var battle = ctx.battle();
        final var features = ctx.features();
        // 基础 summary 构建期就统一读取 partial 门禁：killVictims 等事件流观测伤害段一并抑制
        final boolean observedDamagePartial = hasObservedDamagePartial(ctx);

        int authoritativeDealt = 0;
        int authoritativeReceived = 0;
        if (battle == null) {
            sb.append("=== 警告：无权威结算数据 ===\n");
            return sb.toString();
        }

        // ====== 1. Battle result (authoritative) ======
        sb.append("=== 战斗结算数据（权威） ===\n");
        sb.append("地图: ").append(PlayerResultFormat.quoteForPrompt(ReplayDisplayNames.mapName(battle.mapName))).append('\n');
        if (battle.arenaBonusType != null) {
            sb.append("模式编号: ").append(battle.arenaBonusType).append('\n');
        }
        if (battle.durationS != null) {
            sb.append("时长: ").append(PlayerAnalysisTerms.battleClock(battle.durationS.floatValue())).append('\n');
        }
        sb.append(PlayerAnalysisPromptFormatter.formatWinner(battle)).append('\n');

        final PlayerResult rec = battle.recorderResult();
        final Side recSide = rec != null ? PlayerSideResolver.resolve(battle, rec) : Side.UNKNOWN;

        // ====== 2. Recorder authoritative stats ======
        // 战绩本身在下面的 YOU_AUTHORITATIVE 段统一输出，这里不再重复一份
        if (rec != null) {
            authoritativeDealt = rec.damageDealt;
            authoritativeReceived = rec.damageReceived;
        }

        // ====== 3-4. FRIENDLY_LINEUP, ENEMY_LINEUP, UNKNOWN_LINEUP ======
        final List<PlayerResult> allPlayers = battle.players != null ? battle.players : List.of();
        final Map<PlayerResult, Side> allSides = PlayerSideResolver.resolveAll(battle);
        final List<PlayerResult> friendlies = allPlayers.stream()
                .filter(p -> allSides.getOrDefault(p, Side.UNKNOWN) == Side.FRIENDLY).toList();
        final List<PlayerResult> enemies = allPlayers.stream()
                .filter(p -> allSides.getOrDefault(p, Side.UNKNOWN) == Side.ENEMY).toList();
        final List<PlayerResult> unknowns = allPlayers.stream()
                .filter(p -> allSides.getOrDefault(p, Side.UNKNOWN) == Side.UNKNOWN).toList();

        // 玩家本人单独成段，绝不再以「友方/队友」身份出现在队友阵容里
        if (rec != null) {
            sb.append("\n=== YOU_AUTHORITATIVE（你的战绩·权威结算） ===\n");
            PlayerEvidenceFormatter.appendPlayerLine(sb, rec, true, true);
        }
        sb.append("\n=== TEAMMATE_LINEUP_AUTHORITATIVE（你的队友阵容·权威结算，不含你本人） ===\n");
        boolean anyTeammate = false;
        for (final PlayerResult p : friendlies) {
            if (PlayerAnalysisPromptFormatter.isSamePlayer(p, rec)) continue;
            PlayerEvidenceFormatter.appendPlayerLine(sb, p, true);
            anyTeammate = true;
        }
        if (!anyTeammate) {
            sb.append("（无可用队友数据）\n");
        }
        sb.append("=== ENEMY_LINEUP_AUTHORITATIVE（敌方阵容·权威结算） ===\n");
        for (final PlayerResult p : enemies) {
            PlayerEvidenceFormatter.appendPlayerLine(sb, p, false);
        }
        if (!unknowns.isEmpty()) {
            sb.append("=== UNKNOWN_LINEUP_AUTHORITATIVE（未确定阵营·权威结算） ===\n");
            for (final PlayerResult p : unknowns) {
                sb.append("未知 ").append(PlayerResultFormat.quoteForPrompt(p.nickname))
                        .append(" 坦克: ").append(PlayerResultFormat.quoteForPrompt(ReplayDisplayNames.tankName(p.tankId, p.tankName)))
                        .append(" 车种: ").append(ReplayDisplayNames.tankClass(p.tankId))
                        .append(" 输出").append(p.damageDealt)
                        .append(" 击杀").append(p.kills)
                        .append('\n');
            }
        }

        // ====== 5. Class counts (backend-computed) ======
        PlayerEvidenceFormatter.appendClassSummary(sb, friendlies, enemies, unknowns, battle);

        // ====== 6. Backend-computed aggregates ======
        PlayerEvidenceFormatter.appendAggregates(sb, friendlies, enemies, unknowns);

        // ====== 7. Recorder ranking ======
        if (rec != null && !friendlies.isEmpty()) {
            PlayerEvidenceFormatter.appendRecorderRanking(sb, rec, friendlies, battle);
        }

        // ====== 7b. Recorder per-target damage exchange (observed subset) ======
        final boolean damageExchangeAvailable = PlayerEvidenceFormatter.appendRecorderDamageExchange(
                sb, battle, rec, observedDamagePartial);

        // ====== 7c. Kill attribution: 谁击杀录像者 / 录像者击杀谁 ======
        final boolean killAttributionAvailable = PlayerEvidenceFormatter.appendKillAttribution(
                sb, battle, rec, observedDamagePartial);

        // ====== 8. Death timeline (authoritative) ======
        sb.append("\n=== DEATH_TIMELINE_AUTHORITATIVE（阵亡时间线·权威结算） ===\n");
        PlayerEvidenceFormatter.appendDeathTimeline(sb, battle);

        // ====== 9. Event stream evidence ======
        PlayerEvidenceFormatter.appendEventStreamEvidence(sb, ctx, battle);

        // ====== 10. Side-based limitations ======
        // prompt 要求逐对手对炮与击杀归因；数据缺失时必须显式告知，避免 AI 跳过或编造
        if (!damageExchangeAvailable) {
            sb.append("- DAMAGE_EXCHANGE_UNAVAILABLE\n");
        }
        if (!killAttributionAvailable) {
            sb.append("- KILL_ATTRIBUTION_UNAVAILABLE\n");
        }
        if (!unknowns.isEmpty()) {
            final boolean recUnresolved = rec == null || allSides.getOrDefault(rec, Side.UNKNOWN) == Side.UNKNOWN;
            if (recUnresolved) {
                sb.append("- RECORDER_TEAM_UNRESOLVED\n");
            }
            sb.append("- SIDE_AGGREGATES_UNAVAILABLE\n");
        }
        return sb.toString();
    }

    /**
     * 从结算数据构建可靠的死亡时间线（按死亡时刻升序），外加战斗结束事件。
     */
    private static List<KeyBattleEvent> buildDeathTimeline(final Battle battle) {
        final List<KeyBattleEvent> events = new ArrayList<>();
        if (battle.players != null) {
            final var dead = battle.players.stream()
                    .filter(p -> !p.survived)
                    .sorted(Comparator
                            .comparingDouble((PlayerResult p) -> PlayerResultFormat.deathSec(p) > 0
                                    ? PlayerResultFormat.deathSec(p) : Double.MAX_VALUE)
                            .thenComparingLong(p -> p.accountId))
                    .toList();
            final PlayerResult recorder = battle.recorderResult();
            for (final PlayerResult p : dead) {
                final float deathSec = (float) PlayerResultFormat.deathSec(p);
                // 玩家本人写「你」，同队写「队友」，对方写「敌方」；本人绝不出现为「友方」
                final String who = PlayerAnalysisPromptFormatter.isSamePlayer(p, recorder)
                        ? "你"
                        : switch (PlayerSideResolver.resolve(battle, p)) {
                            case FRIENDLY -> "队友 " + PlayerResultFormat.quoteForPrompt(p.nickname);
                            case ENEMY -> "敌方 " + PlayerResultFormat.quoteForPrompt(p.nickname);
                            case UNKNOWN -> "未知阵营 " + PlayerResultFormat.quoteForPrompt(p.nickname);
                        };
                events.add(new KeyBattleEvent(deathSec, "VEHICLE_DESTROYED",
                        PlayerAnalysisTerms.knownDeathClock(deathSec) + " " + who
                                + "（" + PlayerResultFormat.quoteForPrompt(
                                        ReplayDisplayNames.tankName(p.tankId, p.tankName)) + "）"
                                + (deathSec > 0 ? "阵亡" : "阵亡（时刻未知）")));
            }
        }
        final float endSec = battle.durationS != null ? battle.durationS.floatValue() : 0f;
        final Winner winner = FriendlyEnemyResult.resolve(battle);
        events.add(new KeyBattleEvent(endSec, "BATTLE_END",
                "战斗结束，" + FriendlyEnemyResult.label(winner)));
        return List.copyOf(events);
    }

    /**
     * 构建以结算数据为准的紧凑战局摘要。
     */
    static String buildSummary(final Battle battle, final ReplayReconstruction recon, final List<KeyBattleEvent> keyEvents) {
        final StringBuilder sb = new StringBuilder(2048);
        sb.append("地图: ").append(PlayerResultFormat.quoteForPrompt(ReplayDisplayNames.mapName(battle.mapName))).append('\n');
        if (battle.arenaBonusType != null) {
            sb.append("模式编号: ").append(battle.arenaBonusType).append('\n');
        }
        if (battle.durationS != null) {
            sb.append("时长: ").append(PlayerAnalysisTerms.battleClock(battle.durationS.floatValue())).append('\n');
        }
        sb.append(PlayerAnalysisPromptFormatter.formatWinner(battle)).append('\n');

        // 玩家本人的战绩由 formatAllPlayersBySide 的「=== 你 ===」段统一输出，此处不再重复
        if (battle.recorderResult() == null) {
            sb.append("\n(未能定位你的战绩)\n");
        }

        sb.append("\n").append(PlayerAnalysisPromptFormatter.formatAllPlayersBySide(battle));

        sb.append("\n死亡时间线:\n");
        for (final KeyBattleEvent e : keyEvents) {
            sb.append("- [").append(PlayerAnalysisTerms.battleClock(e.clockSec())).append("] ")
                    .append(e.label()).append('\n');
        }

        // 位置/走位维度：仅报告可用性，不臆断（逐帧血量无法可靠解码，已在文档中说明）
        if (recon != null) {
            sb.append("\n位置时间线: 可用（").append(recon.events().size())
                    .append(" 个领域事件，含位置流；如需走位分析可据此展开）\n");
        } else {
            sb.append("\n位置时间线: 不可用（完整重建未成功，本次仅基于结算数据分析）\n");
        }

        return sb.toString();
    }

}

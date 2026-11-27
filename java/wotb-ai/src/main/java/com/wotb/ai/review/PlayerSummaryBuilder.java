package com.wotb.ai.review;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.EvidenceDensity;
import com.wotb.core.ai.PlannedPrompt;
import com.wotb.core.ai.SingleReplayPromptPlanner;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.KeyBattleEvent;
import com.wotb.core.replay.feature.SinglePlayerBattleAnalysisContext;
import com.wotb.core.replay.processing.FriendlyEnemyResult;
import com.wotb.core.replay.processing.FriendlyEnemyResult.Winner;
import com.wotb.core.replay.processing.PlayerSideResolver;
import com.wotb.core.replay.processing.PlayerSideResolver.Side;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelinePerspective;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;

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
        Objects.requireNonNull(battle, "battle");
        final List<KeyBattleEvent> keyEvents = buildDeathTimeline(battle);
        final String enemySection = EnemyLastKnownPositionsSection.renderPlayerSection(battle, recon);
        final String phaseSection = BattlePhaseTimelineSection.renderPlayerSection(buildFallbackPhases(battle));
        final Integer recorderTeam = PlayerSideResolver.resolveRecorderTeam(battle);
        final String pointsSection = recorderTeam == null ? ""
                : PointsSituationEvidence.renderSection(
                        battle, recon, recorderTeam, true, "你的队伍", "敌方");
        final String timelineSection = timelineSection(battle, recon);
        final String summary = buildSummary(battle, recon, keyEvents)
                + (phaseSection.isEmpty() ? "" : "\n" + phaseSection)
                + (enemySection.isEmpty() ? "" : "\n" + enemySection)
                + (pointsSection.isEmpty() ? "" : "\n" + pointsSection)
                + (timelineSection.isEmpty() ? "" : "\n" + timelineSection);
        final String systemPrompt = PlayerPromptRules.systemPrompt("player/fallback", language);
        return new PreparedAiPrompt(systemPrompt, summary, "SINGLE_PLAYER_SUMMARY",
                EvidenceDensity.LEVEL_1_COMPRESSED, 0);
    }

    static String timelineSection(final Battle battle, final ReplayReconstruction recon) {
        if (battle == null || recon == null) {
            return "";
        }
        try {
            final PlayerResult recorder = battle.recorderResult();
            if (recorder == null || recorder.accountId <= 0 || recorder.team <= 0) {
                return "";
            }
            final BattleTimelineResult result = BattleTimelineBuilder.build(
                    battle, recon, TimelinePerspective.personal(
                            recorder.accountId, recorder.team));
            if (!result.usable()) {
                return "";
            }
            return "\n======================== TACTICAL TIMELINE（时间有序战局章节·battle-relative 确定性） ========================\n"
                    + PersonalAiContextCompiler.renderTimelineSection(result.timeline(), recorder.accountId);
        } catch (final RuntimeException e) {
            return "";
        }
    }

    private static List<BattlePhaseSummary> buildFallbackPhases(final Battle battle) {
        final float battleEnd = battle != null && battle.durationS != null
                ? battle.durationS.floatValue() : Float.NaN;
        return BattlePhaseSummary.buildRelativePhasesWithSurvival(
                BattlePhaseSummary.UNKNOWN_FIRST_CONTACT, battleEnd,
                BattlePhaseSummary.SurvivalTimeline.fromBattleResults(
                        battle, PlayerSideResolver.resolveRecorderTeam(battle)));
    }

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
        final Integer recorderTeam = ctx.battle() == null
                ? null : PlayerSideResolver.resolveRecorderTeam(ctx.battle());
        final String pointsSection = recorderTeam == null ? ""
                : PointsSituationEvidence.renderSection(
                        ctx.battle(), null, recorderTeam, true, "你的队伍", "敌方");
        final String summary = buildPlayerContextSummary(ctx)
                + (pointsSection.isEmpty() ? "" : "\n" + pointsSection);
        final String systemPrompt = PlayerPromptRules.systemPrompt("player/single", language);
        final List<Map<String, Object>> messages = List.of(
                Map.<String, Object>of("role", "system", "content", systemPrompt),
                Map.<String, Object>of("role", "user", "content", summary));
        final int estimatedTokens = estimator.estimateMessagesTokens(messages);
        AiPromptBudgetGuard.enforce(estimatedTokens, maxInputTokens, contextWindowTokens,
                maxOutputTokens, promptSafetyMarginTokens);
        return new PreparedAiPrompt(systemPrompt, summary, "SINGLE_PLAYER_BATTLE",
                EvidenceDensity.LEVEL_1_COMPRESSED, estimatedTokens);
    }

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
        final boolean observedDamagePartial = hasObservedDamagePartial(ctx);
        PlayerCombatEvidenceFormatter.appendDamageExchangeByOpponent(
                summaryBuilder, ctx.battle(), recorderAccountId, recon, observedDamagePartial);
        if (!PlayerCombatEvidenceFormatter.appendPerHitDamageEvents(
                summaryBuilder, ctx.battle(), recorderAccountId, recon, observedDamagePartial)) {
            summaryBuilder.append("- PER_HIT_DAMAGE_EVENTS_UNAVAILABLE\n");
        }
        PlayerCombatEvidenceFormatter.appendRecorderDamageReceivedWindows(
                summaryBuilder, ctx.battle(), recon, recorderAccountId, observedDamagePartial);
        final PlayerResult rec = ctx.battle() == null ? null : ctx.battle().recorderResult();
        if (rec != null) {
            PlayerCombatEvidenceFormatter.appendRecorderDamageExchange(
                    summaryBuilder, ctx.battle(), recon, rec, observedDamagePartial);
            PlayerCombatEvidenceFormatter.appendKillAttribution(
                    summaryBuilder, ctx.battle(), recon, rec, observedDamagePartial);
        }
        PlayerCombatEvidenceFormatter.appendEnemyLastKnownPositions(summaryBuilder, ctx.battle(), recon);
        final String behindLine = RelativeDepthHpEvidence.renderPlayerSection(
                ctx.battle(), recon, recorderAccountId, observedDamagePartial);
        if (!behindLine.isEmpty()) {
            summaryBuilder.append(behindLine);
        }

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
        final String systemPrompt = PlayerPromptRules.systemPrompt("player/single", language);
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
        final boolean observedDamagePartial = hasObservedDamagePartial(ctx);

        int authoritativeDealt = 0;
        int authoritativeReceived = 0;
        if (battle == null) {
            sb.append("=== 警告：无权威结算数据 ===\n");
            return sb.toString();
        }

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

        if (rec != null) {
            authoritativeDealt = rec.damageDealt;
            authoritativeReceived = rec.damageReceived;
        }

        final List<PlayerResult> allPlayers = battle.players != null ? battle.players : List.of();
        final Map<PlayerResult, Side> allSides = PlayerSideResolver.resolveAll(battle);
        final List<PlayerResult> friendlies = allPlayers.stream()
                .filter(p -> allSides.getOrDefault(p, Side.UNKNOWN) == Side.FRIENDLY).toList();
        final List<PlayerResult> enemies = allPlayers.stream()
                .filter(p -> allSides.getOrDefault(p, Side.UNKNOWN) == Side.ENEMY).toList();
        final List<PlayerResult> unknowns = allPlayers.stream()
                .filter(p -> allSides.getOrDefault(p, Side.UNKNOWN) == Side.UNKNOWN).toList();

        if (rec != null) {
            sb.append("\n=== YOU_AUTHORITATIVE（你的战绩·权威结算） ===\n");
            PlayerRosterEvidenceFormatter.appendPlayerLine(sb, battle, rec, true, true);
        }
        sb.append("\n=== TEAMMATE_LINEUP_AUTHORITATIVE（你的队友阵容·权威结算，不含你本人） ===\n");
        boolean anyTeammate = false;
        for (final PlayerResult p : friendlies) {
            if (PlayerAnalysisPromptFormatter.isSamePlayer(p, rec)) continue;
            PlayerRosterEvidenceFormatter.appendPlayerLine(sb, battle, p, true);
            anyTeammate = true;
        }
        if (!anyTeammate) {
            sb.append("（无可用队友数据）\n");
        }
        sb.append("=== ENEMY_LINEUP_AUTHORITATIVE（敌方阵容·权威结算） ===\n");
        for (final PlayerResult p : enemies) {
            PlayerRosterEvidenceFormatter.appendPlayerLine(sb, battle, p, false);
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

        PlayerRosterEvidenceFormatter.appendClassSummary(sb, friendlies, enemies, unknowns, battle);

        PlayerRosterEvidenceFormatter.appendAggregates(sb, battle, friendlies, enemies, unknowns);

        if (rec != null && !friendlies.isEmpty()) {
            PlayerRosterEvidenceFormatter.appendRecorderRanking(sb, rec, friendlies, battle);
        }

        sb.append("\n=== DEATH_TIMELINE_AUTHORITATIVE（阵亡时间线·权威结算） ===\n");
        PlayerRosterEvidenceFormatter.appendDeathTimeline(sb, battle);

        PlayerReplayEventFormatter.appendEventStreamEvidence(sb, ctx, battle);

        if (!unknowns.isEmpty()) {
            final boolean recUnresolved = rec == null || allSides.getOrDefault(rec, Side.UNKNOWN) == Side.UNKNOWN;
            if (recUnresolved) {
                sb.append("- RECORDER_TEAM_UNRESOLVED\n");
            }
            sb.append("- SIDE_AGGREGATES_UNAVAILABLE\n");
        }
        return sb.toString();
    }

    private static List<KeyBattleEvent> buildDeathTimeline(final Battle battle) {
        final List<KeyBattleEvent> events = new ArrayList<>();
        if (battle.players != null) {
            final var dead = battle.players.stream()
                    .filter(p -> !p.survived && PlayerResultFormat.deathSec(p) > 0)
                    .sorted(Comparator
                            .comparingDouble((PlayerResult p) -> PlayerResultFormat.deathSec(p) > 0
                                    ? PlayerResultFormat.deathSec(p) : Double.MAX_VALUE)
                            .thenComparingLong(p -> p.accountId))
                    .toList();
            final PlayerResult recorder = battle.recorderResult();
            for (final PlayerResult p : dead) {
                final float deathSec = (float) PlayerResultFormat.deathSec(p);
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
                                + "阵亡"));
            }
        }
        final float endSec = battle.durationS != null ? battle.durationS.floatValue() : 0f;
        final Winner winner = FriendlyEnemyResult.resolve(battle);
        events.add(new KeyBattleEvent(endSec, "BATTLE_END",
                "战斗结束，" + FriendlyEnemyResult.label(winner)));
        return List.copyOf(events);
    }

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

        if (battle.recorderResult() == null) {
            sb.append("\n(未能定位你的战绩)\n");
        }

        sb.append("\n").append(PlayerAnalysisPromptFormatter.formatAllPlayersBySide(battle));

        sb.append("\n死亡时间线:\n");
        for (final KeyBattleEvent e : keyEvents) {
            sb.append("- [").append(PlayerAnalysisTerms.battleClock(e.clockSec())).append("] ")
                    .append(e.label()).append('\n');
        }

        if (recon != null) {
            sb.append("\n位置时间线: 可用（").append(recon.events().size())
                    .append(" 个领域事件，含位置流；如需走位分析可据此展开）\n");
        } else {
            sb.append("\n位置时间线: 不可用（完整重建未成功，本次仅基于结算数据分析）\n");
        }

        return sb.toString();
    }

}

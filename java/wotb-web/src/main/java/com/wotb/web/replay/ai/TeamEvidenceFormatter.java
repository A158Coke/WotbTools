package com.wotb.web.replay.ai;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.FriendlyEnemyResult;
import com.wotb.core.processing.FriendlyEnemyResult.Winner;
import com.wotb.core.processing.PlayerSideResolver;
import com.wotb.core.processing.TeamPerspectiveLabelResolver;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.evidence.AiEvidence;
import com.wotb.core.replay.evidence.TeamSoloIntentSkill;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.CanonicalMapPosition;
import com.wotb.core.replay.feature.KeyBattleEvent;
import com.wotb.core.replay.feature.MapCoordinateResolution;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.TeamAggregateResult;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamEngagementSummary;
import com.wotb.core.replay.feature.TeamFormationCluster;
import com.wotb.core.replay.feature.TeamFormationPhase;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import com.wotb.core.replay.feature.TeamObservedAggregate;
import com.wotb.core.replay.map.MapTacticalSemanticsRegistry;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.util.PlayerResultFormat;
import com.wotb.core.util.PromptDataQuoter;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 团队证据格式化器：把 Team 特征/结算/事件证据渲染为确定性 prompt 片段（对方阵容、
 * 权威/观测聚合、成员事实、移动/队形/交火/阶段/关键事件、Call #1 prior 与死亡时间线），
 * 以及基于 token 预算的 BudgetWriter。
 * <p>从 {@link TeamAiPromptBuilder} 拆出，纯静态工具类；single/multi 组装与预算编排保留在原类。</p>
 */
final class TeamEvidenceFormatter {

    private TeamEvidenceFormatter() {
    }

    private static final MapTacticalSemanticsRegistry SEMANTICS_REGISTRY =
            MapTacticalSemanticsRegistry.load();

    static String priorSection(final PreBattleStrategicPrior prior,
                                       final int perspectiveTeam,
                                       final String teamLabel) {
        final StringBuilder sb = new StringBuilder(2048);
        sb.append("=== PRE-BATTLE STRATEGIC PRIOR（Call #1 赛前战略基线，仅基于地图与双方阵容，未读取任何战斗结果） ===\n");
        if (prior == null || !prior.hasContent()) {
            sb.append("（本次赛前战略基线不可用：Call #1 未产出有效结果）\n");
            return sb.toString();
        }
        final boolean swapped = perspectiveTeam == 2;
        final PreBattleStrategicPrior.TeamProfile teamAProfile = swapped
                ? prior.teamB() : prior.teamA();
        final PreBattleStrategicPrior.TeamProfile teamBProfile = swapped
                ? prior.teamA() : prior.teamB();
        final String teamALabel = "TEAM_A（你的队伍"
                + (StringUtils.hasText(teamLabel) ? " " + teamLabel : "") + "）";
        appendTeamProfile(sb, teamALabel, teamAProfile);
        appendTeamProfile(sb, "TEAM_B（对方队伍）", teamBProfile);
        if (!prior.keyMatchups().isEmpty()) {
            sb.append("\n关键对阵:\n");
            for (final PreBattleStrategicPrior.KeyMatchup m : prior.keyMatchups()) {
                sb.append("  - 区域 ").append(quoteData(m.area()))
                        .append(" | 优势 ").append(quoteData(swapped ? swapTeamToken(m.advantage()) : m.advantage()))
                        .append(" | ").append(quoteData(m.reason())).append('\n');
            }
        }
        if (!prior.strategicWinConditions().isEmpty()) {
            sb.append("\n战略胜机:\n");
            for (final PreBattleStrategicPrior.StrategicWinCondition w : prior.strategicWinConditions()) {
                sb.append("  - ").append(quoteData(swapped ? swapTeamToken(w.team()) : w.team()))
                        .append(": ").append(quoteData(w.condition())).append('\n');
            }
        }
        if (!prior.hypotheses().isEmpty()) {
            sb.append("\n战略假设（复盘对照：预期 vs 实际，考虑一波流等特殊战局）:\n");
            for (final PreBattleStrategicPrior.StrategicHypothesis h : prior.hypotheses()) {
                sb.append("  [").append(hypothesisIdLabel(h.id())).append("] ")
                        .append(quoteData(swapped ? swapTeamToken(h.claim()) : h.claim()))
                        .append("（理由: ").append(quoteData(swapped ? swapTeamToken(h.reason()) : h.reason()))
                        .append("）\n");
            }
        }
        return sb.toString();
    }

    static void appendTeamProfile(final StringBuilder sb,
                                          final String label,
                                          final PreBattleStrategicPrior.TeamProfile profile) {
        if (profile == null) {
            return;
        }
        sb.append('\n').append(label).append(":\n");
        if (!profile.strengths().isEmpty()) {
            sb.append("  优势: ").append(String.join("；", profile.strengths())).append('\n');
        }
        if (!profile.weaknesses().isEmpty()) {
            sb.append("  劣势: ").append(String.join("；", profile.weaknesses())).append('\n');
        }
        if (!profile.preferredPlans().isEmpty()) {
            sb.append("  预期最优打法（分阶段）: ").append(String.join("；", profile.preferredPlans())).append('\n');
        }
    }

    static String hypothesisIdLabel(final String id) {
        if (id == null) {
            return "H?";
        }
        final String sanitized = id.replaceAll("[\\[\\]\\n\\r]", " ").trim();
        return sanitized.isBlank() ? "H?" : sanitized;
    }

    static String swapTeamToken(final String text) {
        if (text == null || text.isBlank()) {
            return text == null ? "" : text;
        }
        return text.replace("TEAM_A", "\u0000A")
                .replace("TEAM_B", "TEAM_A")
                .replace("\u0000A", "TEAM_B");
    }

    static void appendHighPriorityFacts(
            final BudgetWriter writer,
            final TeamBattleFeatureSet features,
            final String analysisUnitId,
            final List<String> limitations,
            final Map<Long, Integer> observedMaxHpByAccount
    ) {
        writer.append("\n=== PERSPECTIVE_FACTS ===\n");
        writer.append("analysisUnitId=" + quoteData(analysisUnitId) + "\n");
        if (features == null) {
            writer.append("features=UNAVAILABLE\n");
            return;
        }
        appendAuthoritative(writer, features.authoritativeAggregate());
        // 使用合并后的 limitations（context + features + extra），不能只检查 features.limitations
        appendObserved(writer, features.observedAggregate(), limitations);
        appendMemberFacts(writer, features.members(), observedMaxHpByAccount);
        writer.append("coverage=" + features.coverage() + "\n");
    }

    static boolean appendOpposingTeam(
            final BudgetWriter writer,
            final Battle battle,
            final int perspectiveTeam
    ) {
        if (battle == null || battle.players == null
                || !PlayerSideResolver.isValidRawTeam(perspectiveTeam)) {
            return false;
        }
        final List<PlayerResult> opponents = battle.players.stream()
                .filter(p -> PlayerSideResolver.isValidRawTeam(p.team) && p.team != perspectiveTeam)
                .toList();
        if (opponents.isEmpty()) {
            return false;
        }
        writer.append("\n=== OPPOSING_TEAM_LINEUP_AUTHORITATIVE（对方阵容·权威结算） ===\n");
        int damage = 0;
        int received = 0;
        int assisted = 0;
        int blocked = 0;
        int kills = 0;
        int survivors = 0;
        for (final PlayerResult p : opponents) {
            writer.append("opponent accountId=" + p.accountId
                    + " nickname=" + quoteData(p.nickname)
                    + " tank=" + quoteData(resolveTankName(p.tankId, p.tankName))
                    + " vehicleClass=" + resolveTankClass(p.tankId)
                    + structuredTankFacts(p.tankId, p.observedMaxHp)
                    + " finalDamage=" + p.damageDealt
                    + " damageReceived=" + p.damageReceived
                    + " assisted=" + p.damageAssisted
                    + " blocked=" + p.damageBlocked
                    + " kills=" + p.kills
                    + " hits=" + p.nHitsDealt
                    + " penetrations=" + p.nPenetrationsDealt
                    + " enemiesDamaged=" + p.nEnemiesDamaged
                    + " death=" + PlayerAnalysisTerms.survivalDisplay(
                            p.survived, PlayerResultFormat.deathSec(p))
                    + "\n");
            damage += p.damageDealt;
            received += p.damageReceived;
            assisted += p.damageAssisted;
            blocked += p.damageBlocked;
            kills += p.kills;
            if (p.survived) survivors++;
        }
        writer.append("\n=== OPPOSING_TEAM_AUTHORITATIVE_RESULT（对方合计·权威结算） ===\n");
        writer.append("opponentCount=" + opponents.size()
                + " finalDamage=" + damage
                + " damageReceived=" + received
                + " assisted=" + assisted
                + " blocked=" + blocked
                + " kills=" + kills
                + " survivors=" + survivors
                + "\n");
        return true;
    }

    static String structuredTankFacts(final long tankId) {
        return structuredTankFacts(tankId, null);
    }

    /** 同上；observedMaxHp 非空时覆盖 hp 事实（回放实测，含装备/物资加成）。 */
    static String structuredTankFacts(final long tankId, final Integer observedMaxHp) {
        final StringBuilder sb = new StringBuilder(80);
        appendFact(sb, "tier", ReplayDisplayNames.tankTier(tankId));
        appendFact(sb, "nation", ReplayDisplayNames.tankNation(tankId));
        appendFact(sb, "alphaDamage", ReplayDisplayNames.tankAlphaDamage(tankId));
        appendFact(sb, "hp", observedMaxHp != null && observedMaxHp > 0
                ? String.valueOf(observedMaxHp) : ReplayDisplayNames.tankMaxHp(tankId));
        sb.append(extraInfoFact(ReplayDisplayNames.tankExtraInfo(tankId)));
        return sb.toString();
    }

    static void appendFact(final StringBuilder sb, final String key, final String value) {
        if (!value.isEmpty()) {
            sb.append(' ').append(key).append('=').append(value);
        }
    }

    static String extraInfoFact(final String extraInfo) {
        return extraInfo.isEmpty() ? "" : " extraInfo=" + quoteData(extraInfo);
    }

    static void appendOptionalDetails(
            final BudgetWriter writer,
            final TeamBattleFeatureSet features,
            final String analysisUnitId,
            final String mapCode,
            final Battle battle,
            final int perspectiveTeam,
            final List<String> limitations
    ) {
        writer.append("\n=== PERSPECTIVE_OPTIONAL ===\n");
        writer.append("analysisUnitId=" + quoteData(analysisUnitId) + "\n");
        if (features == null) {
            return;
        }
        appendMemberMovements(writer, features.members(), mapCode);
        appendFormation(writer, features.formationPhases());
        appendBattlePhases(writer, features.battlePhases(), battle, perspectiveTeam);
        // 覆盖不全时 Team Engagement 的 dealtSubset/receivedSubset 是事件流伤害数字：一并抑制
        appendEngagements(writer, features.engagements(),
                limitations != null && limitations.contains("OBSERVED_DAMAGE_IS_PARTIAL"));
        appendKeyEvents(writer, features.keyEvents());
        appendCaptureAndPoints(writer, battle, perspectiveTeam, mapCode);
        appendSoloIntentCandidates(writer, features, battle, mapCode);
    }

    /** 争霸赛占点证据段（权威结算 + 静态占领点区域；P3 optional）。 */
    static void appendCaptureAndPoints(
            final BudgetWriter writer,
            final Battle battle,
            final int perspectiveTeam,
            final String mapCode
    ) {
        if (battle == null || battle.players == null) {
            return;
        }
        final long earned = battle.players.stream()
                .filter(player -> player != null && player.team == perspectiveTeam)
                .mapToLong(player -> player.victoryPointsEarned)
                .sum();
        final long seized = battle.players.stream()
                .filter(player -> player != null && player.team == perspectiveTeam)
                .mapToLong(player -> player.victoryPointsSeized)
                .sum();
        final long opposingEarned = battle.players.stream()
                .filter(player -> player != null && player.team != perspectiveTeam)
                .mapToLong(player -> player.victoryPointsEarned)
                .sum();
        final FriendlyEnemyResult.TeamBattleWinner winner =
                FriendlyEnemyResult.resolveTeamBattle(battle, perspectiveTeam);
        final boolean rosterComplete = FriendlyEnemyResult.rosterComplete(battle);
        writer.append("\n=== CAPTURE_AND_POINTS（争霸赛占点·权威结算） ===\n");
        writer.append("pointsDecided=" + winner.pointsDecided() + "\n");
        if (!rosterComplete) {
            // 结算阵容不完整：逐人/双方占点分只是部分数据，不得当作权威总量或推断点数结束方式。
            // mandatory header 的 result 行同步降级为 UNKNOWN/「点数判定」，口径保持一致。
            writer.append("SETTLEMENT_ROSTER_INCOMPLETE=true\n");
            writer.append("pointsTotalsUnavailable=true\n");
            writer.append("directive=结算阵容不完整：占点分总量不可用，禁止用残缺点数推断胜方或「时间耗尽/达到 1000 分」结束方式\n");
        }
        if (winner.pointsDecided()) {
            writer.append("winnerSource=" + winner.source().name() + "\n");
            // pointsDecided=true 表示结束时刻双方均未全员阵亡（非全歼）：结束方式只按
            // 「标准业务规则 + 时长」判定，不使用任何点数字段——时长<420s → REACHED_1000，
            // 时长≥420s → TIME_EXPIRED；类别未知/结算阵容不完整（rosterComplete=false）→ UNKNOWN，
            // 只写通用「点数判定」。全歼获胜（一方全员阵亡）时 pointsDecided=false，不写点数结束方式。
            writer.append("pointsEndReason=" + winner.pointsEndReason().name() + "\n");
        }
        if (rosterComplete) {
            final int opposingTeam = perspectiveTeam == 1 ? 2 : 1;
            final long opposingSeized = battle.players.stream()
                    .filter(player -> player != null && player.team == opposingTeam)
                    .mapToLong(player -> player.victoryPointsSeized)
                    .sum();
            final long teamKills = FriendlyEnemyResult.teamKills(battle, perspectiveTeam);
            final long teamDeaths = FriendlyEnemyResult.teamDeaths(battle, perspectiveTeam);
            final long opposingKills = FriendlyEnemyResult.teamKills(battle, opposingTeam);
            final long opposingDeaths = FriendlyEnemyResult.teamDeaths(battle, opposingTeam);
            writer.append("team victoryPointsEarned=" + earned
                    + " victoryPointsSeized=" + seized
                    + " kills=" + teamKills + " deaths=" + teamDeaths + "\n");
            writer.append("opposing victoryPointsEarned=" + opposingEarned
                    + " victoryPointsSeized=" + opposingSeized
                    + " kills=" + opposingKills + " deaths=" + opposingDeaths + "\n");
            for (final PlayerResult player : battle.players) {
                if (player != null && player.team == perspectiveTeam
                        && (player.victoryPointsEarned > 0 || player.victoryPointsSeized > 0
                        || player.kills > 0)) {
                    writer.append("member accountId=" + player.accountId
                            + " nickname=" + quoteData(player.nickname)
                            + " victoryPointsEarned=" + player.victoryPointsEarned
                            + " victoryPointsSeized=" + player.victoryPointsSeized
                            + " kills=" + player.kills + "\n");
                }
            }
            if (winner.pointsDecided()) {
                // 终局比分：回放无已验证的实时点数/终局比分解码。唯一可分配的是业务规则可证明的
                // 提前结束（标准规则 + 双方均有存活 + 时长<420s → REACHED_1000）：
                // 权威胜方（winnerTeam）已知时，胜方终局比分=1000（1000 分上限业务约定），失败方 UNKNOWN；
                // winnerTeam 缺失时只写「某一方达到 1000 分导致提前结束，具体胜方未知」，
                // 双方终局比分一律 UNKNOWN（结束原因 REACHED_1000 与胜方/比分三者解耦）。
                final boolean reached1000 =
                        winner.pointsEndReason() == FriendlyEnemyResult.PointsEndReason.REACHED_1000;
                if (reached1000 && winner.winner() != Winner.DRAW_OR_UNKNOWN) {
                    writer.append("finalScore: team="
                            + (winner.winner() == Winner.FRIENDLY_WIN
                                    ? FriendlyEnemyResult.SUPREMACY_WIN_POINTS
                                            + "（达到1000分上限提前结束, 业务规则）" : "UNKNOWN")
                            + " opposing="
                            + (winner.winner() == Winner.ENEMY_WIN
                                    ? FriendlyEnemyResult.SUPREMACY_WIN_POINTS
                                            + "（达到1000分上限提前结束, 业务规则）" : "UNKNOWN")
                            + "\n");
                } else if (reached1000) {
                    writer.append("finalScore: team=UNKNOWN opposing=UNKNOWN "
                            + "(某一方达到 1000 分导致提前结束, 具体胜方未知, 终局比分未知)\n");
                } else {
                    writer.append("finalScore: team=UNKNOWN opposing=UNKNOWN "
                            + "(无已验证的实时点数/终局比分证据, 不可计算)\n");
                }
                writer.append("directive=争霸赛业务规则(项目所有者确认): 战斗时长固定7分钟(420s)、"
                        + "胜利点数上限1000分(达到上限即提前结束), "
                        + "游戏不提供时长调整; arenaBonusType 只证明战斗类别, 420s/1000不是从该字段解码出来的; "
                        + "每据点每tick产分与tick间隔均未解码(无任何已验证的tick产分规则), "
                        + "禁止用tick数或占点分计算终局比分; 击毁车辆通常会改变双方点数"
                        + "(每击杀夺取对方40分、本方掉人损失40分), 但结算字段 victoryPointsEarned 是否已含该调整"
                        + "未经证明, 禁止用「占点分+40×击杀−40×阵亡」等公式计算结果冒充终局比分; "
                        + "无权威胜方(winnerTeam缺失)时: 仅当 rosterComplete=true 且一方全员阵亡才可用"
                        + "SURVIVOR_SETTLEMENT 按完整结算存活状态推导全歼胜方, 双方均有存活时胜方未知, "
                        + "禁止比较占点字段推断胜方; REACHED_1000 是结束原因(某一方达到1000分导致提前结束), "
                        + "与胜方解耦: winnerTeam 缺失时仍写「某一方达到 1000 分导致提前结束, 具体胜方未知」, "
                        + "双方终局比分一律 UNKNOWN; 只有 winnerTeam 已知时才把胜方"
                        + "finalScore=1000(1000分上限业务约定), 失败方终局比分一律 UNKNOWN, 禁止编造双方精确比分\n");
            }
        } else {
            writer.append("team victoryPointsEarned=UNKNOWN victoryPointsSeized=UNKNOWN\n");
            writer.append("opposing victoryPointsEarned=UNKNOWN\n");
        }
        final List<String> regions = new ArrayList<>(
                TeamSoloIntentSkill.controlPointRegions(SEMANTICS_REGISTRY.semanticsFor(mapCode)));
        regions.sort(String::compareTo);
        writer.append("controlPointRegions="
                + (regions.isEmpty() ? "UNKNOWN" : regions) + "\n");
    }

    /**
     * 点数局势证据段（P3 optional）：击杀夺分时间线 + 占领点区域位置存在 +
     * 进攻推进窗口（含推进方窗口内承受伤害 = 防守方过路费）。
     * 口径：实时比分未解码，只给可证明信号；OBSERVED_DAMAGE_IS_PARTIAL 时抑制伤害数字。
     */
    static void appendPointsSituation(
            final BudgetWriter writer,
            final Battle battle,
            final ReplayReconstruction recon,
            final int perspectiveTeam,
            final boolean damagePartial
    ) {
        final String section = PointsSituationEvidence.renderSection(
                battle, recon, perspectiveTeam, damagePartial, "本队", "对方");
        if (!section.isEmpty()) {
            writer.append(section);
        }
    }

    /** 单走行为候选段（TeamSoloIntentSkill 规则候选，PARTIAL；P3 optional）。 */
    static void appendSoloIntentCandidates(
            final BudgetWriter writer,
            final TeamBattleFeatureSet features,
            final Battle battle,
            final String mapCode
    ) {
        final List<AiEvidence> candidates = TeamSoloIntentSkill.detect(
                features, battle, features.battlePhases(),
                SEMANTICS_REGISTRY.semanticsFor(mapCode));
        if (candidates.isEmpty()) {
            return;
        }
        writer.append("\n=== SOLO_INTENT_SIGNALS（单走行为信号） ===\n");
        for (final AiEvidence candidate : candidates) {
            writer.append("[" + format(candidate.startSec()) + "-" + format(candidate.endSec()) + "] "
                    + candidate.summary() + "\n");
            writer.append("  intent=" + candidate.labels().get("intent")
                    + " distanceM=" + format(candidate.numbers().get("distanceM"))
                    + " stationaryRatio=" + format(candidate.numbers().get("stationaryRatio"))
                    + " teammateBenefit=" + format(candidate.numbers().get("teammateBenefit"))
                    + " objectiveProximity=" + format(candidate.numbers().get("objectiveProximity"))
                    + " nearbyEnemy=" + format(candidate.numbers().get("nearbyEnemy"))
                    + " region=" + candidate.labels().get("region")
                    + " confidence=部分\n");
        }
    }

    static void appendAuthoritative(
            final BudgetWriter writer,
            final TeamAggregateResult aggregate
    ) {
        writer.append("\n=== AUTHORITATIVE_TEAM_RESULT ===\n");
        if (aggregate == null) {
            writer.append("UNAVAILABLE\n");
            return;
        }
        writer.append("memberCount=" + aggregate.memberCount() + "\n");
        writer.append("damageDealt=" + aggregate.totalDamageDealt() + "\n");
        writer.append("damageReceived=" + aggregate.totalDamageReceived() + "\n");
        writer.append("assistedDamage=" + aggregate.totalAssistedDamage() + "\n");
        writer.append("blockedDamage=" + aggregate.totalBlockedDamage() + "\n");
        writer.append("kills=" + aggregate.totalKills() + "\n");
        writer.append("survivors=" + aggregate.survivorCount() + "\n");
        writer.append("deaths=" + aggregate.deathCount() + "\n");
        writer.append("averageDeathTime=" + deathTimeLabel(aggregate.averageDeathTimeSec()) + "\n");
        writer.append("firstDeathTime=" + deathTimeLabel(aggregate.firstDeathTimeSec()) + "\n");
        writer.append("lastDeathTime=" + deathTimeLabel(aggregate.lastDeathTimeSec()) + "\n");
        writer.append("win=" + formatScalar(aggregate.win()) + "\n");
    }

    static String deathTimeLabel(final Double deathTimeSec) {
        return deathTimeSec == null || !Double.isFinite(deathTimeSec) || deathTimeSec <= 0
                ? "UNKNOWN" : PlayerAnalysisTerms.battleClock((float) deathTimeSec.doubleValue());
    }

    static void appendObserved(
            final BudgetWriter writer,
            final TeamObservedAggregate aggregate,
            final List<String> limitations
    ) {
        writer.append("\n=== OBSERVED_EVENT_SUBSET_NOT_AUTHORITATIVE ===\n");
        if (aggregate == null) {
            writer.append("UNAVAILABLE\n");
            return;
        }
        // 事件流迄今仅逆向出 sub3 直接伤害子类型；type 5/31/35/39 与其他 EntityMethod
        // 伤害子类型尚未逆向，观测子集无法与权威结算对齐。为避免 AI 在并排数字间误读
        // （如「观测 18443 vs 权威 20360」），缺口未清零前抑制数字输出，
        // 强制 AI 以 AUTHORITATIVE_TEAM_RESULT 为唯一可信口径。
        // 待事件流覆盖达 100%（观测=权威）后，从此处恢复数字输出。
        if (limitations != null && limitations.contains("OBSERVED_DAMAGE_IS_PARTIAL")) {
            writer.append("coverage=PARTIAL numbersSuppressed=true\n");
            writer.append("reason=OBSERVED_DAMAGE_IS_PARTIAL\n");
            writer.append("directive=以 AUTHORITATIVE_TEAM_RESULT 为唯一可信口径；事件流观测子集覆盖不全，不得引用其数字\n");
            return;
        }
        writer.append("damageDealtSubset=" + aggregate.damageDealt() + "\n");
        writer.append("damageReceivedSubset=" + aggregate.damageReceived() + "\n");
        writer.append("attributedDamageEvents=" + aggregate.attributedDamageEventCount() + "\n");
        writer.append("unattributedDamageEvents="
                + aggregate.unattributedDamageEventCount() + "\n");
    }

    /**
     * 逐成员掉血时间窗口（事件流观测子集）：把每名成员的受击 DamageEvent 聚类成窗口，
     * 输出时间范围 + 总掉血量。与 {@code OBSERVED_EVENT_SUBSET} 同一覆盖率口径：
     * {@code OBSERVED_DAMAGE_IS_PARTIAL} 时抑制数字，输出 UNAVAILABLE。
     */
    static void appendMemberDamageReceivedWindows(
            final BudgetWriter writer,
            final Battle battle,
            final List<TeamMemberFeatureSet> members,
            final ReplayReconstruction recon,
            final boolean suppressObservedNumbers) {
        if (members == null || members.isEmpty()) {
            return;
        }
        if (suppressObservedNumbers) {
            writer.append("\n=== MEMBER_DAMAGE_RECEIVED_WINDOWS ===\n");
            writer.append("UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)\n");
            return;
        }
        final StringBuilder rows = new StringBuilder(1024);
        for (final TeamMemberFeatureSet member : members) {
            final List<DamageWindowClusterer.DamageWindow> windows =
                    DamageWindowClusterer.receivedWindows(battle, recon, member.accountId());
            if (windows.isEmpty()) {
                continue;
            }
            rows.append("member accountId=").append(member.accountId())
                    .append(" nickname=").append(quoteData(member.nickname()))
                    .append(" damageReceivedWindows=");
            for (final DamageWindowClusterer.DamageWindow window : windows) {
                rows.append(PlayerAnalysisTerms.battleRange(window.startSec(), window.endSec()))
                        .append("掉血").append(window.totalDamage())
                        .append('/').append(window.hitCount()).append("次")
                        .append("攻击者").append(window.uniqueAttackerCount())
                        .append(window.attackersUnresolved() ? "（部分未解析）" : "")
                        .append(window.focusFireCandidate() ? "（短时多车集火证据）" : "")
                        .append(window.entryHpProven() ? "伤害/进场满血pct=" : "伤害/base满血pct=")
                        .append(window.damageVsEntryMaxHpPct() == null
                                ? "未知" : Math.round(window.damageVsEntryMaxHpPct()) + "%")
                        .append(window.criticalWindow() ? "（短窗高额伤害窗口）" : "");
            }
            rows.append('\n');
        }
        if (rows.isEmpty()) {
            return;
        }
        writer.append("\n=== MEMBER_DAMAGE_RECEIVED_WINDOWS（逐成员掉血窗口·事件流观测） ===\n");
        writer.append("注意: 每条为一名成员的掉血窗口, 观测子集, 非权威总量; 攻击者N=窗口内不同攻击者数; "
                + "只有窗口总跨度 ≤" + (int) DamageWindowClusterer.SHORT_FOCUS_WINDOW_SEC
                + " 秒、攻击者≥2 且无未解析攻击者时才标注「（短时多车集火证据）」; "
                + "攻击者=1 → 短时间集中掉血/高压掉血窗口（不是集火）; "
                + "标注「（部分未解析）」时攻击者数不完整, 不得断言集火; "
                + "链式聚类形成的大跨度窗口不得当作短时集火; "
                + "伤害/进场满血pct=窗口累计伤害/已证明进场满血量(回放受击前样本证明, 含装备/物资加成)的百分比; "
                + "伤害/base满血pct=窗口累计伤害/tankopedia 基础血量的百分比(进场满血未被证明时的 base baseline, "
                + "只是计算基准, 不是实际掉血比例; 未知则为「未知」); "
                + "仅当进场满血被证明且窗口跨度≤" + (int) DamageWindowClusterer.CRITICAL_WINDOW_SPAN_SEC
                + " 秒、伤害≥" + (int) DamageWindowClusterer.CRITICAL_HP_PCT
                + "% 已证明进场满血量才标注「（短窗高额伤害窗口）」; "
                + "数据无法证明窗口起始血量/窗口内阵亡/装备加成后的实际最大血量, 不得判定「从满血被秒杀」.\n");
        writer.append(rows.toString());
    }

    static void appendMemberFacts(
            final BudgetWriter writer,
            final List<TeamMemberFeatureSet> members
    ) {
        appendMemberFacts(writer, members, null);
    }

    static void appendMemberFacts(
            final BudgetWriter writer,
            final List<TeamMemberFeatureSet> members,
            final Map<Long, Integer> observedMaxHpByAccount
    ) {
        writer.append("\n=== TEAM_MEMBERS ===\n");
        for (final TeamMemberFeatureSet member : members) {
            writer.append("member accountId=" + member.accountId()
                    + " nickname=" + quoteData(member.nickname())
                    + " tank=" + quoteData(resolveTankName(member.tankId(), member.tankName()))
                    // vehicleClass / tier / nation 只来自 tankopedia 的结构化字段，不得由 tank 名称推断
                    + " vehicleClass=" + resolveTankClass(member.tankId())
                    + structuredTankFacts(member.tankId(),
                            observedMaxHpByAccount == null ? null : observedMaxHpByAccount.get(member.accountId()))
                    + " entityIds=" + member.entityIds()
                    + " mapping=" + PlayerAnalysisTerms.confidenceLabel(member.mappingConfidence())
                    + " finalDamage=" + member.finalDamage()
                    + " damageReceived=" + member.damageReceived()
                    + " assisted=" + member.assistedDamage()
                    + " blocked=" + member.blockedDamage()
                    + " kills=" + member.kills()
                    + " survived=" + member.survived()
                    + " deathTime=" + (member.deathTimeSec() == null
                            ? "未知" : PlayerAnalysisTerms.survivalDisplay(
                                    member.survived(), member.deathTimeSec()))
                    + "\n");
            final TeamMemberFeatureSet.DeathProximity prox = member.deathProximity();
            if (prox != null) {
                writer.append("  deathProximityMeters=" + format(prox.distanceMeters())
                        + " observedDeltaSec=" + format(prox.observedDeltaSec())
                        + " confidence=" + PlayerAnalysisTerms.confidenceLabel(prox.confidence())
                        + "\n");
            }
            if (!member.limitations().isEmpty()) {
                writer.append("  memberLimitations=" + member.limitations() + "\n");
            }
        }
    }

    static void appendMemberMovements(
            final BudgetWriter writer,
            final List<TeamMemberFeatureSet> members,
            final String mapCode
    ) {
        boolean hasMovements = false;
        for (final TeamMemberFeatureSet teamMemberFeatureSet : members) {
            if (!teamMemberFeatureSet.movements().isEmpty()) {
                hasMovements = true;
                break;
            }
        }
        if (!hasMovements) return;
        writer.append("\n=== MEMBER_MOVEMENTS ===\n");
        for (final TeamMemberFeatureSet member : members) {
            if (member.movements().isEmpty()) continue;
            // 必须标出归属成员：否则所有成员的移动段被打成一个匿名平铺列表，AI 无法归属
            writer.append("member accountId=" + member.accountId()
                    + " nickname=" + quoteData(member.nickname())
                    + " tank=" + quoteData(resolveTankName(member.tankId(), member.tankName()))
                    + " vehicleClass=" + resolveTankClass(member.tankId())
                    + "\n");
            // 压缩区域序列（1-9 区，与回放九宫格一致）：让 AI 一眼看到该成员的整场路线
            final List<String> regionSequence = new ArrayList<>();
            String lastRegion = null;
            for (final MovementSegment movement : member.movements()) {
                final String startRegion = regionOf(movement.rawStartPosition(), mapCode);
                if (startRegion != null && !startRegion.equals(lastRegion)) {
                    regionSequence.add(startRegion);
                    lastRegion = startRegion;
                }
                final String endRegion = regionOf(movement.rawEndPosition(), mapCode);
                if (endRegion != null && !endRegion.equals(lastRegion)) {
                    regionSequence.add(endRegion);
                    lastRegion = endRegion;
                }
            }
            if (!regionSequence.isEmpty()) {
                writer.append("  regionSequence=" + String.join("→", regionSequence) + "\n");
            }
            for (final MovementSegment movement : member.movements()) {
                final String startInfo = formatRawPosition(movement.rawStartPosition(), mapCode);
                final String endInfo = formatRawPosition(movement.rawEndPosition(), mapCode);
                writer.append("  movement[" + format(movement.startTime())
                        + "-" + format(movement.endTime()) + "]"
                        + " type=" + PlayerAnalysisTerms.movementLabel(movement.type())
                        + " distance=" + format(movement.distance())
                        + " avgSpeed=" + format(movement.averageSpeed())
                        + " start=" + startInfo
                        + " end=" + endInfo
                        + " confidence=" + PlayerAnalysisTerms.confidenceLabel(movement.confidence())
                        + "\n");
            }
        }
    }

    static void appendFormation(
            final BudgetWriter writer,
            final List<TeamFormationPhase> phases
    ) {
        writer.append("\n=== FORMATION_PHASES ===\n");
        for (final TeamFormationPhase phase : phases) {
            final String phasePosInfo = formatCanonicalPosition(phase.centroid());
            writer.append("formation[" + format(phase.startTime())
                    + "-" + format(phase.endTime()) + "]"
                    + " " + phasePosInfo
                    + " dispersion=" + format(phase.averageDispersion())
                    + " clusters=" + phase.clusterCount()
                    + " members=" + phase.observedMemberCount()
                    + " confidence=" + PlayerAnalysisTerms.confidenceLabel(phase.confidence())
                    + "\n");
            // Structured cluster output
            for (final TeamFormationCluster cluster : phase.clusters()) {
                writer.append("  cluster[" + format(cluster.startTime())
                        + "-" + format(cluster.endTime()) + "]"
                        + " region=" + cluster.region()
                        + " centroidXZ=(" + format(cluster.centroidX())
                        + "," + format(cluster.centroidZ()) + ")"
                        + " centroidStatus=" + cluster.centroidStatus()
                        + " clampedMemberPositions=" + cluster.clampedMemberPositionCount()
                        + " members=" + cluster.memberIdentities().stream()
                        .map(id -> PromptDataQuoter.quote(id, "?"))
                        .collect(Collectors.joining(",", "[", "]"))
                        + " memberCount=" + cluster.memberCount()
                        + " confidence=" + PlayerAnalysisTerms.confidenceLabel(cluster.confidence())
                        + "\n");
            }
        }
    }

    static void appendEngagements(
            final BudgetWriter writer,
            final List<TeamEngagementSummary> engagements,
            final boolean partial
    ) {
        writer.append("\n=== TEAM_ENGAGEMENTS_OBSERVED_SUBSET ===\n");
        if (partial) {
            writer.append("UNAVAILABLE (OBSERVED_DAMAGE_IS_PARTIAL)\n");
            return;
        }
        for (final TeamEngagementSummary engagement : engagements) {
            writer.append("engagement[" + format(engagement.startTime())
                    + "-" + format(engagement.endTime()) + "]"
                    + " allies=" + engagement.alliedAccountIds()
                    + " enemies=" + engagement.enemyAccountIds()
                    + " dealtSubset=" + engagement.damageDealt()
                    + " receivedSubset=" + engagement.damageReceived()
                    + " focusedTargets=" + engagement.focusedTargetAccountIds()
                    + " targetSwitches=" + engagement.targetSwitchCount()
                    + " outcome=" + PlayerAnalysisTerms.outcomeLabel(engagement.outcome())
                    + " confidence=" + PlayerAnalysisTerms.confidenceLabel(engagement.confidence())
                    + "\n");
        }
    }

    static void appendKeyEvents(
            final BudgetWriter writer,
            final List<KeyBattleEvent> events
    ) {
        writer.append("\n=== KEY_EVENTS ===\n");
        for (final KeyBattleEvent event : events) {
            writer.append("event[" + format(event.clockSec()) + "]"
                    + " type=" + PlayerAnalysisTerms.keyEventLabel(event.type())
                    + " evidence=" + quoteData(event.label())
                    + " source=" + event.source()
                    + " confidence=" + PlayerAnalysisTerms.confidenceLabel(event.confidence())
                    + " entities=" + event.relatedEntityIds()
                    + "\n");
        }
    }

    static String formatScalar(final Object value) {
        if (value == null) {
            return "UNKNOWN";
        }
        if (value instanceof Number number
                && !Double.isFinite(number.doubleValue())) {
            return "UNKNOWN";
        }
        return String.valueOf(value);
    }

    static String quoteData(final Object value) {
        return PromptDataQuoter.quote(value, "UNKNOWN");
    }

    static String resolveMapName(final String mapCode) {
        return ReplayDisplayNames.mapName(mapCode);
    }

    static String resolveTeamResult(final Battle battle, final int perspectiveTeam,
                                            final String teamLabel) {
        final var winner = FriendlyEnemyResult.resolveTeamBattle(battle, perspectiveTeam);
        final String label = StringUtils.hasText(teamLabel) ? teamLabel : "本队";
        final String base = switch (winner.winner()) {
            case FRIENDLY_WIN -> label + "获胜";
            case ENEMY_WIN -> label + "落败";
            case DRAW_OR_UNKNOWN -> "平局或未知";
        };
        if (winner.winner() == Winner.DRAW_OR_UNKNOWN) {
            return base;
        }
        // 全歼双向语义（结算存活状态，与 resultSource 无关）：获胜且对方无存活 / 落败且本方无存活。
        final String annihilation = FriendlyEnemyResult.annihilationSuffix(
                battle, perspectiveTeam, winner.winner());
        if (!annihilation.isEmpty()) {
            return base + annihilation;
        }
        return winner.pointsDecided() ? base + pointsSuffix(winner) : base;
    }

    /** result 行的胜负来源（BATTLE_RESULTS / SURVIVOR_SETTLEMENT / UNKNOWN；无权威胜方时不再做点数推断）。 */
    static String resolveTeamResultSource(final Battle battle, final int perspectiveTeam) {
        return FriendlyEnemyResult.resolveTeamBattle(battle, perspectiveTeam).source().name();
    }

    /** 点数胜负的结束方式后缀：时间耗尽 / 1000 分提前 / 未知。 */
    private static String pointsSuffix(final FriendlyEnemyResult.TeamBattleWinner winner) {
        return switch (winner.pointsEndReason()) {
            case REACHED_1000 -> "（达到 1000 分提前获胜）";
            case TIME_EXPIRED -> "（时间耗尽点数判定）";
            case UNKNOWN, NOT_APPLICABLE -> "（点数判定）";
        };
    }

    static void appendBattlePhases(
            final BudgetWriter writer,
            final List<BattlePhaseSummary> phases,
            final Battle battle,
            final int perspectiveTeam
    ) {
        writer.append("\n=== BATTLE_PHASES ===\n");
        if (phases != null && !phases.isEmpty()) {
            writer.append(BattlePhaseTimelineSection.PHASE_SEMANTICS_NOTE);
            if (battle != null) {
                writer.append("DEATH_SOURCE=" + BattlePhaseSummary.deathSourceLabel(battle) + "\n");
            }
            writer.append(BattlePhaseTimelineSection.renderTeamRows(phases));
            appendDeathTimeline(writer, battle, perspectiveTeam);
        }
    }

    static void appendDeathTimeline(
            final BudgetWriter writer,
            final Battle battle,
            final int perspectiveTeam
    ) {
        if (battle == null || battle.players == null) {
            return;
        }
        final List<PlayerResult> dead = battle.players.stream()
                .filter(p -> PlayerSideResolver.isValidRawTeam(p.team) && !p.survived)
                // 未知死亡时间（deathSec<=0）排到已知时间之后，绝不因 0 被排到整场最前
                .sorted(java.util.Comparator
                        .comparingDouble((PlayerResult p) -> PlayerResultFormat.deathSec(p) > 0
                                ? PlayerResultFormat.deathSec(p) : Double.MAX_VALUE)
                        .thenComparingLong(p -> p.accountId))
                .toList();
        if (dead.isEmpty()) {
            return;
        }
        writer.append("\n=== DEATH_TIMELINE（双方逐车阵亡时刻） ===\n");
        for (final PlayerResult p : dead) {
            final String side = p.team == perspectiveTeam ? "本队" : "对方";
            final double deathSec = PlayerResultFormat.deathSec(p);
            final String clock = deathSec > 0
                    ? PlayerAnalysisTerms.battleClock((float) deathSec) : "未知";
            final String suffix = deathSec > 0 ? "阵亡" : "阵亡（时刻未知）";
            writer.append(clock
                    + " " + side + " " + quoteData(p.nickname)
                    + "（" + quoteData(resolveTankName(p.tankId, p.tankName)) + "）" + suffix + "\n");
        }
    }

    static String format(final double value) {
        return String.format(Locale.ROOT, "%.1f", value);
    }

    static String formatNullable(final Double value) {
        return value == null || !Double.isFinite(value)
                ? "UNKNOWN" : format(value);
    }

    static String formatCanonicalPosition(final CanonicalMapPosition pos) {
        if (pos == null) return "UNKNOWN";
        return "(" + format(pos.x()) + "," + format(pos.z()) + ")";
    }

    static String formatRawPosition(final Vector3 position, final String mapCode) {
        if (position == null) return "UNKNOWN";
        final MapCoordinateResolution res = MapRegionResolver.resolve(position.x(), position.z(), mapCode);
        if (!res.usable()) return "UNKNOWN";
        return "(" + format(res.position().x()) + "," + format(res.position().z())
                + ") r=" + res.region() + " s=" + res.status().name();
    }

    static String regionOf(final Vector3 position, final String mapCode) {
        if (position == null) return null;
        final int region = MapRegionResolver.resolveRegionFromRaw(position.x(), position.z(), mapCode);
        return region > 0 ? String.valueOf(region) : null;
    }

    static String resolvePerspectiveLabel(
            final List<PlayerResult> players, final int perspectiveTeam) {
        if (players == null) return "未知队伍";
        final List<PlayerResult> perspectivePlayers = players.stream()
                .filter(p -> p.team == perspectiveTeam)
                .toList();
        if (perspectivePlayers.isEmpty()) return "未知队伍";
        return TeamPerspectiveLabelResolver.resolve(perspectivePlayers);
    }

    static String resolveTankName(final long tankId, final String existingTankName) {
        return ReplayDisplayNames.tankName(tankId, existingTankName);
    }

    static String resolveTankClass(final long tankId) {
        return ReplayDisplayNames.tankClass(tankId);
    }

    static final class BudgetWriter {

        private static final String TRUNCATION_LINE = "\nLIMITATION: AI_INPUT_TRUNCATED\n";

        final StringBuilder content = new StringBuilder(4096);
        boolean truncated;

        BudgetWriter() {
        }

        void append(final String value) {
            if (StringUtils.hasText(value)) {
                content.append(value);
            }
        }

        void appendRequired(final String value) {
            if (StringUtils.hasText(value)) {
                content.append(value);
            }
        }

        void appendRequiredBlock(final String block) {
            if (StringUtils.hasText(block)) {
                content.append(block);
            }
        }

        String content() {
            return content.toString();
        }

        boolean isTruncated() {
            return truncated;
        }

        void markTruncated() {
            truncated = true;
        }

        TeamAiPromptBuilder.PromptInput finish(
                final AiTokenEstimator estimator,
                final int maxInputTokens,
                final Set<String> suppliedGlobalLimitations,
                final Set<String> includedIds,
                final Set<String> omittedIds,
                final Set<String> truncatedIds,
                final Map<String, List<String>> perUnitLimitations
        ) {
            final Set<String> globalLimitations = new LinkedHashSet<>(suppliedGlobalLimitations);
            // 在 finish 时估算 token 数，如果超限则标记 truncated
            if (estimator != null) {
                final String currentContent = content.toString();
                if (estimator.estimateTextTokens(currentContent) > maxInputTokens) {
                    truncated = true;
                }
            }
            if (truncated) {
                globalLimitations.add("AI_INPUT_TRUNCATED");
                content.append(TRUNCATION_LINE);
            }
            return new TeamAiPromptBuilder.PromptInput(
                    content.toString(),
                    includedIds,
                    omittedIds,
                    truncatedIds,
                    perUnitLimitations,
                    new ArrayList<>(globalLimitations));
        }
    }

}

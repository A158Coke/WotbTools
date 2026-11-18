package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.evidence.AiEvidence;
import com.wotb.core.replay.evidence.TeamSeparationEvidenceSkill;
import com.wotb.core.replay.feature.TeamAggregateResult;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamObservedAggregate;
import com.wotb.core.replay.map.MapTacticalSemanticsRegistry;
import com.wotb.core.replay.processing.FriendlyEnemyResult;
import com.wotb.core.replay.processing.FriendlyEnemyResult.Winner;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.List;

import static com.wotb.ai.review.TeamEvidenceFormatter.format;
import static com.wotb.ai.review.TeamEvidenceFormatter.formatScalar;
import static com.wotb.ai.review.TeamEvidenceFormatter.quoteData;

/** Battle outcome, capture, and aggregate evidence rendering. */
final class TeamOutcomeFormatter {
    private TeamOutcomeFormatter() {
    }

    private static final MapTacticalSemanticsRegistry SEMANTICS_REGISTRY =
            MapTacticalSemanticsRegistry.load();

    /** 争霸赛占点证据段（权威结算 + 静态占领点区域；P3 optional）。 */
    static void appendCaptureAndPoints(
            final TeamPromptBudgetWriter writer,
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
                TeamSeparationEvidenceSkill.controlPointRegions(SEMANTICS_REGISTRY.semanticsFor(mapCode)));
        regions.sort(String::compareTo);
        writer.append("controlPointRegions="
                + (regions.isEmpty() ? "UNKNOWN" : regions) + "\n");
    }

    /**
         * 点数局势证据段（P3 optional）：击杀夺分时间线 + 占领点区域位置存在 +
         * 进入控制点区域窗口（含窗口内进入车辆承受伤害 = 可观测换血事实）。
         * 口径：实时比分未解码，只给可证明信号；OBSERVED_DAMAGE_IS_PARTIAL 时抑制伤害数字。
         */
    static void appendPointsSituation(
            final TeamPromptBudgetWriter writer,
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

    /**
         * 空间分离证据段（TeamSeparationEvidenceSkill 确定性派生证据，PARTIAL；P3 optional）。
         * <p>Backend Evidence Boundary：只输出中性空间结构事实（kind/distance/静止占比/局部敌情/
         * 承伤/输出/主力簇位移/其他队友活动），不输出拖延/脱节/图控等战术 verdict——由 LLM 判断。</p>
         */
    static void appendSpatialSeparationEvidence(
            final TeamPromptBudgetWriter writer,
            final TeamBattleFeatureSet features,
            final Battle battle,
            final String mapCode
    ) {
        final List<AiEvidence> evidence = TeamSeparationEvidenceSkill.detect(
                features, battle, features.battlePhases(),
                SEMANTICS_REGISTRY.semanticsFor(mapCode));
        if (evidence.isEmpty()) {
            return;
        }
        writer.append("\n=== SPATIAL_SEPARATION_EVIDENCE（空间分离证据·中性结构事实） ===\n");
        for (final AiEvidence candidate : evidence) {
            writer.append("[" + format(candidate.startSec()) + "-" + format(candidate.endSec()) + "] "
                    + candidate.summary() + "\n");
            writer.append("  kind=" + candidate.labels().get("kind")
                    + " phase=" + candidate.labels().get("phase")
                    + " movementState=" + candidate.labels().get("movementState")
                    + " distanceM=" + format(candidate.numbers().get("distanceM"))
                    + " distanceGrowthM=" + format(candidate.numbers().get("distanceGrowthM"))
                    + " stationaryRatio=" + format(candidate.numbers().get("stationaryRatio"))
                    + " mainClusterDisplacementM=" + format(candidate.numbers().get("mainClusterDisplacementM"))
                    + " observedEnemyNearby=" + format(candidate.numbers().get("observedEnemyNearby"))
                    + " damageReceivedDuringSpan=" + format(candidate.numbers().get("damageReceivedDuringSpan"))
                    + " damageDealtDuringSpan=" + format(candidate.numbers().get("damageDealtDuringSpan"))
                    + " deathDuringSpan=" + format(candidate.numbers().get("deathDuringSpan"))
                    + " otherFriendlyDeathsDuringSpan=" + format(candidate.numbers().get("otherFriendlyDeathsDuringSpan"))
                    + " otherFriendlyEngagementCountDuringSpan=" + format(candidate.numbers().get("otherFriendlyEngagementCountDuringSpan"))
                    + " otherFriendlyDamageDealtDuringSpan=" + format(candidate.numbers().get("otherFriendlyDamageDealtDuringSpan"))
                    + " otherFriendlyDamageReceivedDuringSpan=" + format(candidate.numbers().get("otherFriendlyDamageReceivedDuringSpan"))
                    + " objectiveProximity=" + format(candidate.numbers().get("objectiveProximity"))
                    + " region=" + candidate.labels().get("region")
                    + " confidence=部分\n");
        }
    }

    static void appendAuthoritative(
            final TeamPromptBudgetWriter writer,
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
            final TeamPromptBudgetWriter writer,
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
}

package com.wotb.core.processing;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;

/**
 * Converts winner team into FRIENDLY_WIN / ENEMY_WIN / DRAW_OR_UNKNOWN
 * for random-battle player-focused analysis.
 * <p>
 * Used in AI prompts so the model never sees raw team numbers.
 * Both winnerTeam and recorderTeam must be 1 or 2 per WoT Blitz domain.
 */
public final class FriendlyEnemyResult {

    /** supremacy 点数胜利阈值：任一方达到该点数立即获胜。 */
    private static final long SUPREMACY_WIN_POINTS = 1000;

    private FriendlyEnemyResult() {}

    public enum Winner {
        FRIENDLY_WIN,
        ENEMY_WIN,
        DRAW_OR_UNKNOWN
    }

    /** 团队赛胜负来源（supremacy 场景的推导链路）。 */
    public enum WinnerSource {
        /** 结算字段 battle_results#winnerTeam 直接给出。 */
        BATTLE_RESULTS,
        /** 结算存活标记：一方全员阵亡，另一方获胜（结算级事实推导；仅当结算阵容完整时）。 */
        SURVIVOR_SETTLEMENT,
        /** 双方均未全灭时的争霸赛点数推断：占点得分高者胜（规则候选，非权威）。 */
        POINTS_INFERENCE,
        UNKNOWN
    }

    /**
     * 点数胜负的结束方式（supremacy 规则）。
     *
     * <p>点数胜负只可能发生在两种情形：任一方达到 1000 分立即获胜（REACHED_1000），
     * 或时间耗尽时比较点数、高者胜（TIME_EXPIRED）。若点数决胜但双方胜利点数均缺失
     * （≤0），无法判定结束方式 → UNKNOWN；非点数胜负 → NOT_APPLICABLE。
     * 仅当结束时刻双方均未全员阵亡（pointsDecided=true）时适用；一方全员阵亡即全歼获胜，
     * pointsEndReason 恒为 NOT_APPLICABLE。</p>
     */
    public enum PointsEndReason {
        /** 非点数胜负（全歼 / 未知）。 */
        NOT_APPLICABLE,
        /** 任一方 victoryPointsEarned ≥ 1000，提前以点数获胜。 */
        REACHED_1000,
        /** 双方均未全员阵亡且均未达 1000 分，时间耗尽后比较点数获胜。 */
        TIME_EXPIRED,
        /** 点数决胜但双方胜利点数缺失，结束方式无法确定。 */
        UNKNOWN
    }

    /**
     * 团队赛（训练房/联赛，恒为争霸赛 supremacy）的胜负解析结果。
     *
     * @param winner       相对 recorderTeam 的胜负
     * @param source       胜负来源（权威结算 / 结算推导 / 点数推断）
     * @param pointsDecided 结束时刻双方均未全员阵亡，说明是点数胜利（supremacy 规则）
     * @param pointsEndReason 点数胜利的结束方式（1000 分提前 / 时间耗尽 / 未知）
     */
    public record TeamBattleWinner(
            Winner winner,
            WinnerSource source,
            boolean pointsDecided,
            PointsEndReason pointsEndReason) {
        public boolean resolved() {
            return winner != Winner.DRAW_OR_UNKNOWN;
        }
    }

    /**
     * Resolve winner relative to the recorder's team.
     * Both teams must be 1 or 2; anything else returns DRAW_OR_UNKNOWN.
     */
    public static Winner resolve(final Integer winnerTeam, final int recorderTeam) {
        if (!PlayerSideResolver.isValidRawTeam(recorderTeam)) {
            return Winner.DRAW_OR_UNKNOWN;
        }
        if (winnerTeam == null || !PlayerSideResolver.isValidRawTeam(winnerTeam)) {
            return Winner.DRAW_OR_UNKNOWN;
        }
        if (winnerTeam.equals(recorderTeam)) return Winner.FRIENDLY_WIN;
        return Winner.ENEMY_WIN;
    }

    /**
     * Resolve winner from a battle (uses recorderTeam internally).
     */
    public static Winner resolve(final Battle battle) {
        if (battle == null) return Winner.DRAW_OR_UNKNOWN;
        final Integer recorderTeam = PlayerSideResolver.resolveRecorderTeam(battle);
        if (recorderTeam == null) return Winner.DRAW_OR_UNKNOWN;
        return resolve(battle.winnerTeam, recorderTeam);
    }

    /**
     * 团队赛（supremacy 争霸赛）胜负解析，供 team perspective 使用。
     *
     * <p>规则：团队赛一定是争霸赛；结束时刻若任意一方全员阵亡则对方获胜（结算级推导，
     * 仅当 {@link Battle#rosterComplete} 为 true 时；名册/战绩不完整时不得用存活数推导胜方），
     * 若双方都未全员阵亡则说明是某一方点数胜利（比较占点得分推断，方向一致时胜方高）。
     * 点数胜利的结束方式按双方胜利点数区分：任一方 ≥1000 为提前获胜，均 <1000 为时间耗尽。
     * 结算 winnerTeam 存在时始终以其为准。数据不足/点数相同仍返回 DRAW_OR_UNKNOWN。</p>
     */
    public static TeamBattleWinner resolveTeamBattle(final Battle battle, final int recorderTeam) {
        if (battle == null || battle.players == null
                || !PlayerSideResolver.isValidRawTeam(recorderTeam)) {
            return new TeamBattleWinner(
                    Winner.DRAW_OR_UNKNOWN, WinnerSource.UNKNOWN, false, PointsEndReason.NOT_APPLICABLE);
        }
        final long team1Total = countTeam(battle, 1);
        final long team2Total = countTeam(battle, 2);
        final long team1Alive = countAlive(battle, 1);
        final long team2Alive = countAlive(battle, 2);
        final boolean bothTeamsPresent = team1Total > 0 && team2Total > 0;
        // supremacy：双方都未全灭 → 点数胜利
        final boolean pointsDecided = bothTeamsPresent && team1Alive > 0 && team2Alive > 0;

        if (battle.winnerTeam != null && PlayerSideResolver.isValidRawTeam(battle.winnerTeam)) {
            return new TeamBattleWinner(
                    resolve(battle.winnerTeam, recorderTeam),
                    WinnerSource.BATTLE_RESULTS,
                    pointsDecided,
                    pointsDecided ? pointsEndReason(battle, recorderTeam) : PointsEndReason.NOT_APPLICABLE);
        }
        if (bothTeamsPresent && (team1Alive == 0 || team2Alive == 0)) {
            // 结算级存活标记：一方全员阵亡，另一方获胜（仅当结算阵容完整，否则不能把未知当零存活）
            if (rosterComplete(battle)) {
                final boolean friendlyWiped = recorderTeam == 1 ? team1Alive == 0 : team2Alive == 0;
                return new TeamBattleWinner(
                        friendlyWiped ? Winner.ENEMY_WIN : Winner.FRIENDLY_WIN,
                        WinnerSource.SURVIVOR_SETTLEMENT,
                        false,
                        PointsEndReason.NOT_APPLICABLE);
            }
        }
        if (pointsDecided) {
            // 点数推断：比较双方占点得分总和（方向与胜方一致时才可用）
            final long team1Points = pointsEarned(battle, 1);
            final long team2Points = pointsEarned(battle, 2);
            if (team1Points != team2Points) {
                final boolean friendlyHigher =
                        recorderTeam == 1 ? team1Points > team2Points : team2Points > team1Points;
                return new TeamBattleWinner(
                        friendlyHigher ? Winner.FRIENDLY_WIN : Winner.ENEMY_WIN,
                        WinnerSource.POINTS_INFERENCE,
                        true,
                        pointsEndReason(team1Points, team2Points));
            }
        }
        return new TeamBattleWinner(
                Winner.DRAW_OR_UNKNOWN,
                WinnerSource.UNKNOWN,
                pointsDecided,
                pointsDecided ? pointsEndReason(battle, recorderTeam) : PointsEndReason.NOT_APPLICABLE);
    }

    private static long countTeam(final Battle battle, final int team) {
        return battle.players.stream()
                .filter(p -> p != null && p.team == team)
                .count();
    }

    private static long countAlive(final Battle battle, final int team) {
        return survivors(battle, team);
    }

    /** 指定团队的结算存活车辆数（团队 1/2）；battle/players 缺失时返回 0。 */
    private static long survivors(final Battle battle, final int team) {
        return battle == null || battle.players == null ? 0L
                : battle.players.stream()
                        .filter(p -> p != null && p.team == team && p.survived)
                        .count();
    }

    /**
     * 全歼双向语义后缀：分析方获胜且对方无存活 → 「（全歼敌方）」；分析方落败且本方无存活 →
     * 「（被敌方全歼）」；其余（含 battle 缺失）返回空串。只看结算存活状态，与 resultSource 无关。
     * fail-closed：perspectiveTeam 非法、players 缺失/为空、结算阵容不完整（rosterComplete != true）、
     * 任一方队伍不在 roster 时一律返回空串，不得把未知当成零存活。
     */
    public static String annihilationSuffix(final Battle battle, final int perspectiveTeam,
                                            final Winner winner) {
        if (battle == null || winner == null
                || !PlayerSideResolver.isValidRawTeam(perspectiveTeam)
                || battle.players == null || battle.players.isEmpty()) {
            return "";
        }
        if (!rosterComplete(battle)) {
            return "";
        }
        if (countTeam(battle, perspectiveTeam) == 0
                || countTeam(battle, opposingTeam(perspectiveTeam)) == 0) {
            // 任一方队伍缺失：不能把未知当成零存活
            return "";
        }
        return switch (winner) {
            case FRIENDLY_WIN -> survivors(battle, opposingTeam(perspectiveTeam)) == 0
                    ? "（全歼敌方）" : "";
            case ENEMY_WIN -> survivors(battle, perspectiveTeam) == 0
                    ? "（被敌方全歼）" : "";
            default -> "";
        };
    }

    private static int opposingTeam(final int perspectiveTeam) {
        return perspectiveTeam == 1 ? 2 : 1;
    }

    /**
     * 结算阵容完整前提（SURVIVOR_SETTLEMENT 推导与 annihilationSuffix 共享）：
     * 仅当 ReplayParser 确认名册(#201)与战绩(#301)账号/队伍一致时返回 true；未知一律视为不完整。
     */
    private static boolean rosterComplete(final Battle battle) {
        return battle != null && Boolean.TRUE.equals(battle.rosterComplete);
    }

    private static long pointsEarned(final Battle battle, final int team) {
        return battle.players.stream()
                .filter(p -> p != null && p.team == team)
                .mapToLong(p -> p.victoryPointsEarned)
                .sum();
    }

    /** 点数胜负结束方式：按双方胜利点数推导（任一方 ≥1000 → 提前获胜；均 <1000 → 时间耗尽；
     * 须在双方均未全员阵亡 / pointsDecided=true 时调用）。 */
    public static PointsEndReason pointsEndReason(final long teamPoints, final long opposingPoints) {
        if (teamPoints <= 0 && opposingPoints <= 0) {
            return PointsEndReason.UNKNOWN;
        }
        return Math.max(teamPoints, opposingPoints) >= SUPREMACY_WIN_POINTS
                ? PointsEndReason.REACHED_1000
                : PointsEndReason.TIME_EXPIRED;
    }

    /** 按 battle 推导 recorder 所在队与其对手的点数胜负结束方式（团队 1/2）。 */
    public static PointsEndReason pointsEndReason(final Battle battle, final int recorderTeam) {
        if (battle == null || battle.players == null
                || !PlayerSideResolver.isValidRawTeam(recorderTeam)) {
            return PointsEndReason.UNKNOWN;
        }
        final int opposingTeam = recorderTeam == 1 ? 2 : 1;
        return pointsEndReason(
                pointsEarned(battle, recorderTeam),
                pointsEarned(battle, opposingTeam));
    }

    /** Short Chinese label for each winner value. */
    public static String label(final Winner w) {
        return switch (w) {
            case FRIENDLY_WIN -> "友方获胜";
            case ENEMY_WIN -> "敌方获胜";
            case DRAW_OR_UNKNOWN -> "平局或未知";
        };
    }
}

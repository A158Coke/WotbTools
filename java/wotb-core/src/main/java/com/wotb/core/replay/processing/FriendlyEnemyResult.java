package com.wotb.core.replay.processing;

import com.wotb.core.model.Battle;

public final class FriendlyEnemyResult {

    public static final long SUPREMACY_WIN_POINTS = 1000;

    public static final long KILL_STEAL_POINTS = 40;

    public static final double SUPREMACY_TIME_LIMIT_SEC = 420;

    private FriendlyEnemyResult() {}

    public enum Winner {
        FRIENDLY_WIN,
        ENEMY_WIN,
        DRAW_OR_UNKNOWN
    }

    public enum WinnerSource {
        BATTLE_RESULTS,
        SURVIVOR_SETTLEMENT,
        POINTS_INFERENCE,
        UNKNOWN
    }

    public enum PointsEndReason {
        NOT_APPLICABLE,
        REACHED_1000,
        TIME_EXPIRED,
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

    public static Winner resolve(final Battle battle) {
        if (battle == null) return Winner.DRAW_OR_UNKNOWN;
        final Integer recorderTeam = PlayerSideResolver.resolveRecorderTeam(battle);
        if (recorderTeam == null) return Winner.DRAW_OR_UNKNOWN;
        return resolve(battle.winnerTeam, recorderTeam);
    }

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
        final boolean pointsDecided = bothTeamsPresent && team1Alive > 0 && team2Alive > 0;

        if (battle.winnerTeam != null && PlayerSideResolver.isValidRawTeam(battle.winnerTeam)) {
            final PointsEndReason endReason = pointsDecided
                    ? (rosterComplete(battle)
                            ? pointsEndReason(battle, recorderTeam)
                            : PointsEndReason.UNKNOWN)
                    : PointsEndReason.NOT_APPLICABLE;
            return new TeamBattleWinner(
                    resolve(battle.winnerTeam, recorderTeam),
                    WinnerSource.BATTLE_RESULTS,
                    pointsDecided,
                    endReason);
        }
        if (bothTeamsPresent && (team1Alive == 0 || team2Alive == 0)) {
            if (rosterComplete(battle)) {
                final boolean friendlyWiped = recorderTeam == 1 ? team1Alive == 0 : team2Alive == 0;
                return new TeamBattleWinner(
                        friendlyWiped ? Winner.ENEMY_WIN : Winner.FRIENDLY_WIN,
                        WinnerSource.SURVIVOR_SETTLEMENT,
                        false,
                        PointsEndReason.NOT_APPLICABLE);
            }
        }
        if (pointsDecided && rosterComplete(battle)) {
            return new TeamBattleWinner(
                    Winner.DRAW_OR_UNKNOWN,
                    WinnerSource.UNKNOWN,
                    true,
                    pointsEndReason(battle, recorderTeam));
        }
        final PointsEndReason endReason = pointsDecided
                ? (rosterComplete(battle)
                        ? pointsEndReason(battle, recorderTeam)
                        : PointsEndReason.UNKNOWN)
                : PointsEndReason.NOT_APPLICABLE;
        return new TeamBattleWinner(
                Winner.DRAW_OR_UNKNOWN,
                WinnerSource.UNKNOWN,
                pointsDecided,
                endReason);
    }

    private static long countTeam(final Battle battle, final int team) {
        return battle.players.stream()
                .filter(p -> p != null && p.team == team)
                .count();
    }

    private static long countAlive(final Battle battle, final int team) {
        return survivors(battle, team);
    }

    private static long survivors(final Battle battle, final int team) {
        return battle == null || battle.players == null ? 0L
                : battle.players.stream()
                        .filter(p -> p != null && p.team == team && p.survived)
                        .count();
    }

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

    public static boolean rosterComplete(final Battle battle) {
        return battle != null && Boolean.TRUE.equals(battle.rosterComplete);
    }

    public static PointsEndReason pointsEndReason(final Battle battle, final int recorderTeam) {
        if (battle == null || battle.players == null
                || !PlayerSideResolver.isValidRawTeam(recorderTeam)) {
            return PointsEndReason.UNKNOWN;
        }
        if (provableEarlyPointsWin(battle)) {
            return PointsEndReason.REACHED_1000;
        }
        if (standardSupremacyRules(battle)
                && battle.durationS != null && battle.durationS >= SUPREMACY_TIME_LIMIT_SEC) {
            return PointsEndReason.TIME_EXPIRED;
        }
        return PointsEndReason.UNKNOWN;
    }

    public static long teamKills(final Battle battle, final int team) {
        return battle == null || battle.players == null ? 0L
                : battle.players.stream()
                        .filter(p -> p != null && p.team == team)
                        .mapToLong(p -> p.kills)
                        .sum();
    }

    public static long teamDeaths(final Battle battle, final int team) {
        return battle == null || battle.players == null ? 0L
                : battle.players.stream()
                        .filter(p -> p != null && p.team == team && !p.survived)
                        .count();
    }

    public static boolean standardSupremacyRules(final Battle battle) {
        if (battle == null || battle.arenaBonusType == null) {
            return false;
        }
        return BattleCategoryUtils.fromArenaBonusType(battle.arenaBonusType) != BattleCategory.UNKNOWN;
    }

    public static boolean provableEarlyPointsWin(final Battle battle) {
        return battle != null && standardSupremacyRules(battle)
                && battle.durationS != null && battle.durationS < SUPREMACY_TIME_LIMIT_SEC;
    }

    public static String label(final Winner w) {
        return switch (w) {
            case FRIENDLY_WIN -> "友方获胜";
            case ENEMY_WIN -> "敌方获胜";
            case DRAW_OR_UNKNOWN -> "平局或未知";
        };
    }
}

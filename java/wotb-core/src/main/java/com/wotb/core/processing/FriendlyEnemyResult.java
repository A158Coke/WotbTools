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
        /** 结算存活标记：一方全员阵亡，另一方获胜（结算级事实推导）。 */
        SURVIVOR_SETTLEMENT,
        /** 双方均未全灭时的争霸赛点数推断：占点得分高者胜（规则候选，非权威）。 */
        POINTS_INFERENCE,
        UNKNOWN
    }

    /**
     * 团队赛（训练房/联赛，恒为争霸赛 supremacy）的胜负解析结果。
     *
     * @param winner       相对 recorderTeam 的胜负
     * @param source       胜负来源（权威结算 / 结算推导 / 点数推断）
     * @param pointsDecided 结束时刻双方均未全员阵亡，说明是点数胜利（supremacy 规则）
     */
    public record TeamBattleWinner(Winner winner, WinnerSource source, boolean pointsDecided) {
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
     * <p>规则：团队赛一定是争霸赛；结束时刻若任意一方全员阵亡则对方获胜（结算级推导），
     * 若双方都未全员阵亡则说明是某一方点数胜利（比较占点得分推断，方向一致时胜方高）。
     * 结算 winnerTeam 存在时始终以其为准。数据不足/点数相同仍返回 DRAW_OR_UNKNOWN。</p>
     */
    public static TeamBattleWinner resolveTeamBattle(final Battle battle, final int recorderTeam) {
        if (battle == null || battle.players == null
                || !PlayerSideResolver.isValidRawTeam(recorderTeam)) {
            return new TeamBattleWinner(Winner.DRAW_OR_UNKNOWN, WinnerSource.UNKNOWN, false);
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
                    pointsDecided);
        }
        if (bothTeamsPresent && (team1Alive == 0 || team2Alive == 0)) {
            // 结算级存活标记：一方全员阵亡，另一方获胜
            final boolean friendlyWiped = recorderTeam == 1 ? team1Alive == 0 : team2Alive == 0;
            return new TeamBattleWinner(
                    friendlyWiped ? Winner.ENEMY_WIN : Winner.FRIENDLY_WIN,
                    WinnerSource.SURVIVOR_SETTLEMENT,
                    false);
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
                        true);
            }
        }
        return new TeamBattleWinner(Winner.DRAW_OR_UNKNOWN, WinnerSource.UNKNOWN, pointsDecided);
    }

    private static long countTeam(final Battle battle, final int team) {
        return battle.players.stream()
                .filter(p -> p != null && p.team == team)
                .count();
    }

    private static long countAlive(final Battle battle, final int team) {
        return battle.players.stream()
                .filter(p -> p != null && p.team == team && p.survived)
                .count();
    }

    private static long pointsEarned(final Battle battle, final int team) {
        return battle.players.stream()
                .filter(p -> p != null && p.team == team)
                .mapToLong(p -> p.victoryPointsEarned)
                .sum();
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

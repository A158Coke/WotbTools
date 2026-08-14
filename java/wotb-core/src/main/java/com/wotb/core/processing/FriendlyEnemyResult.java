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

    /** supremacy 点数胜利阈值：任一方达到该点数立即获胜（提前结束时赢队终局比分恒为此值）。 */
    public static final long SUPREMACY_WIN_POINTS = 1000;

    /** 争霸赛击杀夺分：每击杀夺取对方 40 分补充自身，本方掉人同样损失 40 分（双向计入）。 */
    public static final long KILL_STEAL_POINTS = 40;

    /** 争霸赛标准时长上限（秒）：时长未到该上限即点数决胜结束，必为达到 1000 分提前获胜。 */
    public static final double SUPREMACY_TIME_LIMIT_SEC = 420;

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
        /** 已停用的争霸赛点数推断：占点分不含被动增长与击杀夺分，比较会推出错误胜方，不再产出（fail closed）。 */
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
     * 若双方都未全员阵亡则说明是某一方点数胜利（比较占点得分推断，方向一致时胜方高；
     * 仅当 rosterComplete 为 true，残缺点数不得推断胜方）。
     * 点数胜利的结束方式按双方胜利点数区分：任一方 ≥1000 为提前获胜，均 <1000 为时间耗尽；
     * rosterComplete 不为 true 时 pointsEndReason 降级为 UNKNOWN（只能写通用「点数判定」）。
     * 结算 winnerTeam 存在时始终以其为准（胜方不降级，但点数结束方式仍受完整前提约束）。
     * 数据不足/点数相同仍返回 DRAW_OR_UNKNOWN。</p>
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
        if (pointsDecided && rosterComplete(battle)) {
            // fail closed：无权威胜方时禁止比较占点分推断胜方——
            // victoryPointsEarned 不含被动占点增长与击杀夺分，直接比较会推出错误胜方；
            // 结束方式仍按标准时限证据判定（用于结果行后缀），胜方保持未知。
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
     * 结算阵容完整前提（SURVIVOR_SETTLEMENT / annihilationSuffix / pointsEndReason 共享）：
     * 仅当 ReplayParser 确认名册(#201)与战绩(#301)账号/队伍一致时返回 true；
     * 未知一律视为不完整，残缺点数/存活数不得用于推断胜方或结束方式。
     */
    public static boolean rosterComplete(final Battle battle) {
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
        final long teamPoints = pointsEarned(battle, recorderTeam);
        final long opposingPoints = pointsEarned(battle, opposingTeam);
        // 下界证明：已知逐人占点分（不含被动增长）合计 ≥1000 ⇒ 实际终局必达 1000
        if (Math.max(teamPoints, opposingPoints) >= SUPREMACY_WIN_POINTS) {
            return PointsEndReason.REACHED_1000;
        }
        // 标准时限证据（随机战/官方联赛）+ 时长未到 7 分钟 ⇒ 提前结束，赢队必达 1000
        if (provableEarlyPointsWin(battle)) {
            return PointsEndReason.REACHED_1000;
        }
        // 标准时限下双方部分分均 <1000 且已打到 7 分钟 → 时间耗尽；自定义时限未知 → UNKNOWN
        if (standardSupremacyRules(battle)
                && battle.durationS != null && battle.durationS >= SUPREMACY_TIME_LIMIT_SEC) {
            return PointsEndReason.TIME_EXPIRED;
        }
        return PointsEndReason.UNKNOWN;
    }

    /** 指定团队的结算击杀总数（battle/players 缺失返回 0）。 */
    public static long teamKills(final Battle battle, final int team) {
        return battle == null || battle.players == null ? 0L
                : battle.players.stream()
                        .filter(p -> p != null && p.team == team)
                        .mapToLong(p -> p.kills)
                        .sum();
    }

    /** 指定团队的结算阵亡数（survived=false 计数；名册不完整时仅作口径参考）。 */
    public static long teamDeaths(final Battle battle, final int team) {
        return battle == null || battle.players == null ? 0L
                : battle.players.stream()
                        .filter(p -> p != null && p.team == team && !p.survived)
                        .count();
    }

    /** 击杀夺分净额 = {@link #KILL_STEAL_POINTS} × (击杀 − 阵亡)。 */
    public static long killPointsDelta(final Battle battle, final int team) {
        return KILL_STEAL_POINTS * (teamKills(battle, team) - teamDeaths(battle, team));
    }

    /**
     * 已知部分分（非终局比分）= victoryPointsEarned 合计 + 击杀夺分净额（40×击杀 − 40×阵亡）。
     * <p>victoryPointsEarned(#32) 是逐人占点统计，不含据点被动占点增长，因此本值只是
     * 「已知逐人占点统计与击杀夺分净额」，不是终局比分，调用方不得把它当精确终局比分输出。</p>
     */
    public static long knownPointsSubtotal(final Battle battle, final int team) {
        return pointsEarned(battle, team) + killPointsDelta(battle, team);
    }

    /**
     * 争霸赛标准规则（7 分钟 / 1000 分）可证明的战斗类别：随机战、训练房与官方联赛/锦标赛。
     * 游戏机制不提供战斗时长调整，故所有已知类别恒为标准规则；仅类别未知
     * （arenaBonusType 缺失/未知值）时无法证明，需 fail closed。
     */
    public static boolean standardSupremacyRules(final Battle battle) {
        if (battle == null || battle.arenaBonusType == null) {
            return false;
        }
        return BattleCategoryUtils.fromArenaBonusType(battle.arenaBonusType) != BattleCategory.UNKNOWN;
    }

    /** 标准时限证据成立且时长未到 {@value #SUPREMACY_TIME_LIMIT_SEC} 秒——点数决胜必为达到 1000 分提前获胜。 */
    public static boolean provableEarlyPointsWin(final Battle battle) {
        return battle != null && standardSupremacyRules(battle)
                && battle.durationS != null && battle.durationS < SUPREMACY_TIME_LIMIT_SEC;
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

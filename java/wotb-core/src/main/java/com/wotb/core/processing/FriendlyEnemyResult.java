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

    /** 胜利点数上限 1000 分（项目所有者确认的业务规则；达到上限即提前结束，不是从回放字段解码）。
     *  <p>终局比分可能略超上限（如 990+15=1005），回放可能压缩为 1000——不得断言精确等于 1000。 */
    public static final long SUPREMACY_WIN_POINTS = 1000;

    /** 击杀夺分业务规则（项目所有者确认）：每击杀夺取对方 40 分、本方掉人损失 40 分。
     *  <p>仅作叙述口径，不用于计算——结算字段 victoryPointsEarned 是否已含该调整未经证明。 */
    public static final long KILL_STEAL_POINTS = 40;

    /** 占点得分业务规则（项目所有者确认）：每个据点每次 tick 为己方 +3 或 +5 分，
     *  取值依场次/模式而异（Maus 点数胜利样本为 +5/tick）。tick 间隔与具体取值未解码（UNKNOWN），
     *  仅作叙述口径，不参与任何计算。 */
    public static final long BASE_TICK_POINTS_LOW = 3;
    public static final long BASE_TICK_POINTS_HIGH = 5;

    /** 争霸赛固定战斗时长 420 秒（项目所有者确认的业务规则；游戏不提供时长调整）。 */
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
     * 点数胜负的结束方式（supremacy 规则，项目所有者确认的 420s/1000 业务规则）。
     *
     * <p>仅当结束时刻双方均有存活（pointsDecided=true，调用方保证）时适用；一方全员阵亡即
     * 全歼获胜，pointsEndReason 恒为 NOT_APPLICABLE。判定契约（不使用任何点数公式）：
     * 标准业务规则 + 时长&lt;420s → REACHED_1000（达到 1000 分上限提前获胜；胜方未知时只知
     * 「有人达到1000」，不把1000分配给任何队伍）；标准业务规则 + 时长≥420s → TIME_EXPIRED
     * （时间耗尽，双方终局比分未知）；其余（类别未知/rosterComplete=false/时长未知）→ UNKNOWN。</p>
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
     * 团队赛（supremacy 争霸赛）胜负与结束方式解析，供 team perspective 使用。统一契约：
     * <ul>
     *   <li>BATTLE_RESULTS：结算 winnerTeam 权威胜方，存在时始终以其为准；</li>
     *   <li>SURVIVOR_SETTLEMENT：winnerTeam 缺失时，仅当 rosterComplete=true 且一方全员阵亡，
     *       才按完整结算存活状态推导全歼胜方；</li>
     *   <li>双方均有存活且 winnerTeam 缺失：胜方 UNKNOWN——禁止比较 victoryPointsEarned/Seized
     *       推断胜方（该字段精确语义未经证明）；</li>
     *   <li>rosterComplete=false：禁止用零存活/部分点数/时长推导结束方式（pointsEndReason=UNKNOWN）；</li>
     *   <li>完整阵容 + 双方均有存活 + 标准业务规则（项目所有者确认的 7 分钟/1000 分）+ 时长&lt;420s →
     *       REACHED_1000（winnerTeam 缺失时只知「有人达到1000」，不把1000分配给任何队伍）；</li>
     *   <li>完整阵容 + 双方均有存活 + 标准业务规则 + 时长 ≥420s → TIME_EXPIRED；</li>
     *   <li>其余 → UNKNOWN/NOT_APPLICABLE；任何点数公式不得用于终局比分。</li>
     * </ul>
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

    /** 按 battle 推导 recorder 所在队与其对手的点数胜负结束方式（团队 1/2）。 */
    public static PointsEndReason pointsEndReason(final Battle battle, final int recorderTeam) {
        if (battle == null || battle.players == null
                || !PlayerSideResolver.isValidRawTeam(recorderTeam)) {
            return PointsEndReason.UNKNOWN;
        }
        // 结束方式只按业务规则 + 结算存活证据判定：
        // 项目所有者确认的业务规则：所有已知战斗类别固定 7 分钟（420s）/ 胜利点数上限 1000 分，
        // 游戏不提供时长调整；arenaBonusType 只证明战斗类别，420s/1000 不是从该字段解码出来的。
        // 双方均有存活（pointsDecided，调用方保证）⇒ 非全歼/退出全灭：
        // 时长 <7 分钟提前结束只能是达到 1000 分（业务规则）；时长 ≥7 分钟为时间耗尽。
        if (provableEarlyPointsWin(battle)) {
            return PointsEndReason.REACHED_1000;
        }
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

    /**
     * 争霸赛标准规则可证明的战斗类别：所有已知类别（随机战/训练房/联赛）。
     * <p>注意：420 秒/1000 分是<b>项目所有者确认的业务规则</b>（游戏不提供时长调整），
     * 不是从 {@code arenaBonusType} 字段本身解码出来的——该字段只证明战斗类别；
     * 仅类别未知（arenaBonusType 缺失/未知值）时无法应用业务规则，需 fail closed。</p>
     */
    public static boolean standardSupremacyRules(final Battle battle) {
        if (battle == null || battle.arenaBonusType == null) {
            return false;
        }
        return BattleCategoryUtils.fromArenaBonusType(battle.arenaBonusType) != BattleCategory.UNKNOWN;
    }

    /**
     * 标准业务规则 + 时长未到 {@value #SUPREMACY_TIME_LIMIT_SEC} 秒——点数决胜（双方均有存活）
     * 必为达到 1000 分提前获胜（项目所有者确认的 1000 分上限规则）。
     */
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

package com.wotb.core.league;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * League Rating 严格完整性门槛（标准 7v7、完整结算才允许评分）。
 *
 * <p><b>零值策略</b>（protobuf 零值编码规则）：身份、队伍、车辆、胜方等
 * <b>结构字段</b>按真实存在性 fail-closed（0/非法值直接拒绝）；伤害、助攻、阻挡、击杀、
 * 占点等<b>统计字段</b>合法为 0——proto 未编码的字段解码为 0 与真实 0 无法区分（
 * {@code PlayerResult.raw} 保留字段存在性，但本校验<b>不</b>要求统计字段出现在 raw 中），
 * 缺失与零值同等对待，绝不把「字段缺失」误判为损坏。统计字段只校验<b>数值关系矛盾</b>
 * （负值 / 非有限 / 命中&gt;射击 / 击穿&gt;命中）。</p>
 *
 * <p><b>死亡时间 UNKNOWN ≠ 数据非法</b>：阵亡玩家 {@code survivalTimeSec == 0} 表示
 * 精确死亡时刻无法从回放可靠证明（{@link com.wotb.core.processing.DeathTimeReconciler}
 * 的 fail-closed 结果），这是合法状态——整场仍允许评分，该玩家仅在依赖死亡时刻的
 * Survival/Trade 维度保守得 0 分。{@code survivalTimeSec < 0} / NaN / Infinity /
 * 明显超过战斗时长仍为 {@code INVALID_STAT_FACTS}，整场拒绝评分。</p>
 *
 * <p>返回<b>全部</b>发现的失败（按严重度排序，调用方取第一条作为该场错误码）。</p>
 */
public final class LeagueRatingValidator {

    /** 战斗时长与死亡时间的可容忍偏差（秒）。 */
    private static final double DEATH_TIME_TOLERANCE_SEC = 1.0;

    private LeagueRatingValidator() {
    }

    /** 校验一场 battle；通过返回空列表。 */
    public static List<LeagueFailure> validate(final Battle battle) {
        final List<LeagueFailure> failures = new ArrayList<>();
        if (battle == null) {
            failures.add(new LeagueFailure("", "", LeagueFailure.Code.ARENA_ID_MISSING));
            return failures;
        }
        final String arenaId = battle.arenaId;
        final String arena = arenaId == null ? "" : arenaId;
        final List<PlayerResult> players = battle.players == null ? List.of() : battle.players;

        // 1. arenaId 存在且非空
        if (!StringUtils.hasText(arenaId)) {
            failures.add(new LeagueFailure("", "", LeagueFailure.Code.ARENA_ID_MISSING));
        }

        // 2. 恰好 14 个结算记录 + 两队各 7 人 + 队伍只能为 1/2
        if (players.size() != LeagueRatingNormalizer.TOTAL_PLAYERS) {
            failures.add(new LeagueFailure("", arena, LeagueFailure.Code.NOT_SEVEN_VS_SEVEN));
        }
        int team1 = 0;
        int team2 = 0;
        boolean invalidTeam = false;
        for (final PlayerResult p : players) {
            if (p.team == 1) {
                team1++;
            } else if (p.team == 2) {
                team2++;
            } else {
                invalidTeam = true;
            }
        }
        if (invalidTeam) {
            failures.add(new LeagueFailure("", arena, LeagueFailure.Code.INVALID_TEAM));
        } else if (players.size() == LeagueRatingNormalizer.TOTAL_PLAYERS
                && (team1 != LeagueRatingNormalizer.TEAM_SIZE || team2 != LeagueRatingNormalizer.TEAM_SIZE)) {
            failures.add(new LeagueFailure("", arena, LeagueFailure.Code.NOT_SEVEN_VS_SEVEN));
        }

        // 3. 14 个唯一、非零 accountId
        final Set<Long> accounts = new HashSet<>();
        boolean duplicateOrZeroAccount = false;
        for (final PlayerResult p : players) {
            if (p.accountId == 0 || !accounts.add(p.accountId)) {
                duplicateOrZeroAccount = true;
            }
        }
        if (duplicateOrZeroAccount) {
            failures.add(new LeagueFailure("", arena, LeagueFailure.Code.DUPLICATE_ACCOUNT_ID));
        }

        // 4. 14 名玩家均有非零 tankId
        boolean missingTank = false;
        for (final PlayerResult p : players) {
            if (p.tankId == 0) {
                missingTank = true;
                break;
            }
        }
        if (missingTank) {
            failures.add(new LeagueFailure("", arena, LeagueFailure.Code.MISSING_TANK));
        }

        // 5. League 专属结算覆盖：结算账号全部来自名册（#301 ⊆ #201，无幽灵结算）且名册队伍与
        //    结算队伍无冲突（存在时）。名册 #201 可含 non-combatant extra（标准 7v7 且 #301 完整
        //    14 人时 extra 不属于 14 名 settled combatants，见 protocol.md）——extra 不导致不完整。
        //    注意：不引用全局 Battle.rosterComplete（保持 #201 全集合 == #301 全集合的严格
        //    fail-closed 语义，供 SURVIVOR_SETTLEMENT / annihilation 等推断使用）；League Rating
        //    的宽容由 League 专属证据 settlementAccountsCoveredByRoster /
        //    settlementRosterTeamConsistent 表达。
        if (!Boolean.TRUE.equals(battle.settlementAccountsCoveredByRoster)
                || !Boolean.TRUE.equals(battle.settlementRosterTeamConsistent)) {
            failures.add(new LeagueFailure("", arena, LeagueFailure.Code.ROSTER_INCOMPLETE));
        }

        // 6. winnerTeam 必须明确为 1 或 2（平局/未知不产生 Rating）
        if (battle.winnerTeam == null || (battle.winnerTeam != 1 && battle.winnerTeam != 2)) {
            failures.add(new LeagueFailure("", arena, LeagueFailure.Code.NO_DECISIVE_WINNER));
        }

        // 7. 阵亡玩家死亡时间语义（死亡时间 UNKNOWN ≠ 数据非法）：
        //    survivalTimeSec == 0 = UNKNOWN（合法，允许整场评分——该玩家仅在依赖死亡时刻的
        //    Survival/Trade 维度 fail-closed 得 0 分，见 TradeFacts）；负数 / NaN / Infinity
        //    由下方 hasInvalidStatFacts 统一拒绝（INVALID_STAT_FACTS）；此处只保留
        //    「死亡时间明显超过战斗时长」的矛盾检查（明显矛盾仍为非法 stat facts）。
        boolean contradictoryTime = false;
        final Double duration = battle.durationS;
        for (final PlayerResult p : players) {
            if (!p.survived && Double.isFinite(p.survivalTimeSec)
                    && duration != null && Double.isFinite(duration)
                    && p.survivalTimeSec > duration + DEATH_TIME_TOLERANCE_SEC) {
                contradictoryTime = true;
            }
        }
        if (contradictoryTime) {
            failures.add(new LeagueFailure("", arena, LeagueFailure.Code.INVALID_STAT_FACTS));
        }

        // 8. 数值约束：负值 / 非有限 / 明显违反真实字段关系
        if (hasInvalidStatFacts(players)) {
            failures.add(new LeagueFailure("", arena, LeagueFailure.Code.INVALID_STAT_FACTS));
        }
        return failures;
    }

    /** 统计字段数值关系矛盾检查（统计字段零值合法，不做存在性要求）。 */
    private static boolean hasInvalidStatFacts(final List<PlayerResult> players) {
        for (final PlayerResult p : players) {
            if (p.nShots < 0 || p.nHitsDealt < 0 || p.nPenetrationsDealt < 0
                    || p.damageDealt < 0 || p.damageAssisted < 0 || p.damageReceived < 0
                    || p.kills < 0 || p.damageBlocked < 0
                    || p.victoryPointsEarned < 0 || p.victoryPointsSeized < 0
                    || p.nHitsReceived < 0 || p.nPenetrationsReceived < 0 || p.nEnemiesDamaged < 0) {
                return true;
            }
            if (!Double.isFinite(p.survivalTimeSec) || p.survivalTimeSec < 0) {
                return true;
            }
            if (p.nShots > 0 && p.nHitsDealt > p.nShots) {
                return true;
            }
            if (p.nHitsDealt > 0 && p.nPenetrationsDealt > p.nHitsDealt) {
                return true;
            }
        }
        return false;
    }
}

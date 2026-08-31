package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.evidence.AiEvidence;
import com.wotb.core.replay.processing.PlayerSideResolver;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 逐人确定性团队剖析数据：从权威结算 + 关键窗口派生，只针对 recorderTeam 本方玩家。
 * <p>启发式阈值只作候选线索，是否成立由 Team Autopsy LLM 结合职责基线判断。
 * playerKey 按本方 roster（accountId 升序）稳定编号 P1..P7，无业务推断；
 * weakOutput 均值只使用本方队伍（敌方伤害不影响本方候选）。
 * 结算字段恒为 EXACT；earlyDeath/weakOutput 是 RULE_DERIVED_CANDIDATE 且带各自置信度；
 * deathInCriticalWindow 继承命中窗口 confidence，settlementOnly 时降级（不得 EXACT）。</p>
 */
public final class TeamAutopsyStatsBuilder {

    /** 早死阈值：阵亡时刻早于战斗时长的该比例（是否算"过早"由 LLM 结合车种职责判断）。 */
    public static final double EARLY_DEATH_DURATION_RATIO = 0.5;
    /** 输出不足阈值：damageDealt 低于本方队伍均值的该比例（输出车才适用，由 LLM 判断）。 */
    public static final double WEAK_OUTPUT_MEAN_RATIO = 0.5;

    /**
     * @param recorderTeam     录像者队伍（1/2）；非法时返回空列表（调用方应跳过 TEAM_AUTOPSY）
     * @param recorderAccountId 录像者 accountId；null 表示未知，全部玩家按结算级代理处理
     */
    public List<TeamAutopsyStats> build(final Battle battle,
                                        final List<AiEvidence> criticalWindows,
                                        final int recorderTeam,
                                        final Long recorderAccountId) {
        if (battle == null || battle.players == null || battle.players.isEmpty()
                || !PlayerSideResolver.isValidRawTeam(recorderTeam)) {
            return List.of();
        }
        final List<PlayerResult> teamPlayers = battle.players.stream()
                .filter(p -> p != null && p.team == recorderTeam)
                .sorted(Comparator.comparingLong(p -> p.accountId))
                .toList();
        if (teamPlayers.isEmpty()) {
            return List.of();
        }
        final double meanDamage = teamPlayers.stream()
                .mapToInt(p -> p.damageDealt)
                .average()
                .orElse(0);
        final double duration = battle.durationS != null ? battle.durationS : 0;
        final List<AiEvidence> windows = criticalWindows == null ? List.of() : criticalWindows;
        final List<TeamAutopsyStats> result = new ArrayList<>();
        int index = 0;
        for (final PlayerResult p : teamPlayers) {
            index++;
            final String playerKey = "P" + index;
            final double deathSec = PlayerResultFormat.deathSec(battle, p);
            // deathSec<=0 = 死亡时刻未知（结算缺失 + 事件流被 alive 证据否决/无证据）：不得当作 0s 阵亡或早期阵亡
            final boolean hasDeathData = !p.survived && duration > 0 && deathSec > 0;
            final boolean earlyDeath = hasDeathData
                    && deathSec < duration * EARLY_DEATH_DURATION_RATIO;
            final boolean weakOutput = meanDamage > 0
                    && p.damageDealt < meanDamage * WEAK_OUTPUT_MEAN_RATIO;
            final boolean settlementOnly = recorderAccountId == null
                    || p.accountId != recorderAccountId;
            DecodeConfidence windowConfidence = DecodeConfidence.UNKNOWN;
            boolean deathInWindow = false;
            if (!p.survived && deathSec > 0) {
                for (final AiEvidence w : windows) {
                    if (w != null && deathSec >= w.startSec() && deathSec <= w.endSec()) {
                        deathInWindow = true;
                        windowConfidence = maxConfidence(windowConfidence, w.confidence());
                    }
                }
            }
            if (settlementOnly) {
                windowConfidence = nonExactForSettlement(windowConfidence);
            }
            result.add(new TeamAutopsyStats(
                    playerKey,
                    p.accountId,
                    p.nickname == null ? "" : p.nickname,
                    ReplayDisplayNames.tankName(p.tankId, p.tankName),
                    ReplayDisplayNames.tankClass(p.tankId),
                    ReplayDisplayNames.tankTier(p.tankId),
                    p.team,
                    p.damageDealt,
                    p.damageReceived,
                    p.damageAssisted,
                    p.damageBlocked,
                    p.kills,
                    p.survived,
                    deathSec,
                    earlyDeath,
                    weakOutput,
                    deathInWindow,
                    settlementOnly,
                    DecodeConfidence.EXACT,
                    hasDeathData ? DecodeConfidence.EXACT : DecodeConfidence.PARTIAL,
                    meanDamage > 0 ? DecodeConfidence.EXACT : DecodeConfidence.PARTIAL,
                    windowConfidence));
        }
        return result;
    }

    private static DecodeConfidence maxConfidence(final DecodeConfidence a,
                                                  final DecodeConfidence b) {
        if (a == null) {
            return b;
        }
        if (b == null) {
            return a;
        }
        return rank(a) >= rank(b) ? a : b;
    }

    private static int rank(final DecodeConfidence c) {
        return switch (c) {
            case EXACT -> 3;
            case INFERRED -> 2;
            case PARTIAL -> 1;
            case UNKNOWN -> 0;
        };
    }

    /** 结算级代理（非录像者）的窗口归因不得标为 EXACT。 */
    private static DecodeConfidence nonExactForSettlement(final DecodeConfidence c) {
        return c == DecodeConfidence.EXACT ? DecodeConfidence.PARTIAL : c;
    }
}

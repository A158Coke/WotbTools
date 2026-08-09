package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.evidence.AiEvidence;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.List;

/**
 * 逐人确定性团队剖析数据（V1）：从权威结算 + 关键窗口派生。
 * <p>启发式阈值只作候选线索，是否成立由 Team Autopsy LLM 结合职责基线判断；
 * 阈值语义见各常量 javadoc。权威结算字段恒为 EXACT；依赖窗口/时长等派生数据不完整时降为 PARTIAL。</p>
 */
public final class TeamAutopsyStatsBuilder {

    /** 早死阈值：阵亡时刻早于战斗时长的该比例（是否算"过早"由 LLM 结合车种职责判断）。 */
    public static final double EARLY_DEATH_DURATION_RATIO = 0.5;
    /** 输出不足阈值：damageDealt 低于全队均值的该比例（输出车才适用，由 LLM 判断）。 */
    public static final double WEAK_OUTPUT_MEAN_RATIO = 0.5;

    public List<TeamAutopsyStats> build(final Battle battle,
                                        final List<AiEvidence> criticalWindows,
                                        final Long recorderAccountId) {
        if (battle == null || battle.players == null || battle.players.isEmpty()) {
            return List.of();
        }
        final double meanDamage = battle.players.stream()
                .mapToInt(p -> p.damageDealt)
                .average()
                .orElse(0);
        final double duration = battle.durationS != null ? battle.durationS : 0;
        final List<AiEvidence> windows = criticalWindows == null ? List.of() : criticalWindows;
        final List<TeamAutopsyStats> result = new ArrayList<>();
        for (final PlayerResult p : battle.players) {
            final double deathSec = PlayerResultFormat.deathSec(p);
            final boolean earlyDeath = !p.survived && duration > 0
                    && deathSec < duration * EARLY_DEATH_DURATION_RATIO;
            final boolean weakOutput = meanDamage > 0
                    && p.damageDealt < meanDamage * WEAK_OUTPUT_MEAN_RATIO;
            final boolean deathInWindow = !p.survived && windows.stream()
                    .anyMatch(w -> deathSec >= w.startSec() && deathSec <= w.endSec());
            final boolean settlementOnly = recorderAccountId == null
                    || p.accountId != recorderAccountId;
            final DecodeConfidence confidence = duration > 0 && meanDamage > 0
                    ? DecodeConfidence.EXACT : DecodeConfidence.PARTIAL;
            result.add(new TeamAutopsyStats(
                    p.accountId,
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
                    confidence));
        }
        return result;
    }
}

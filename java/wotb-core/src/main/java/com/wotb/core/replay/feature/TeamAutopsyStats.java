package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;

/**
 * 团队剖析用的逐人确定性数据（V1）：权威结算 + 确定性启发式 flag。
 * <p>只描述"可观察事实"（结算、早死、输出不足、关键窗口内阵亡），战术归因交给 Team Autopsy LLM；
 * 非录像者玩家没有逐人窗口证据，窗口类类别以结算代理近似（{@code settlementOnly=true}）。</p>
 */
public record TeamAutopsyStats(
        long accountId,
        String tankName,
        String tankClass,
        String tankTier,
        int team,
        int damageDealt,
        int damageReceived,
        int damageAssisted,
        int damageBlocked,
        int kills,
        boolean survived,
        double deathSec,
        boolean earlyDeath,
        boolean weakOutput,
        boolean deathInCriticalWindow,
        boolean settlementOnly,
        DecodeConfidence confidence
) {
    public TeamAutopsyStats {
        if (tankName == null) {
            tankName = "未知坦克";
        }
        if (tankClass == null) {
            tankClass = "未知";
        }
        if (tankTier == null) {
            tankTier = "";
        }
        if (confidence == null) {
            confidence = DecodeConfidence.UNKNOWN;
        }
    }
}

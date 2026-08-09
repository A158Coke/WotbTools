package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;

/**
 * 团队剖析用的逐人确定性数据：权威结算 + 确定性启发式 flag（带各自置信度）。
 * <p>身份使用无业务推断的 {@code playerKey}（P1..P7，按 roster 稳定编号），
 * nickname/tankName 仅作展示；同队多辆同名坦克可通过 playerKey 区分。
 * 权威结算字段（damageDealt/Received/assist/block/kills/survived/deathSec）是
 * Battle Result 事实（{@code settlementConfidence}）；earlyDeath/weakOutput 是
 * RULE_DERIVED_CANDIDATE（各自置信度）；deathInCriticalWindow 继承命中窗口的
 * confidence，settlementOnly（非录像者）时不得为 EXACT。</p>
 */
public record TeamAutopsyStats(
        String playerKey,
        long accountId,
        String nickname,
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
        DecodeConfidence settlementConfidence,
        DecodeConfidence earlyDeathConfidence,
        DecodeConfidence weakOutputConfidence,
        DecodeConfidence deathInWindowConfidence
) {
    public TeamAutopsyStats {
        playerKey = playerKey == null ? "" : playerKey;
        nickname = nickname == null ? "" : nickname;
        tankName = tankName == null ? "未知坦克" : tankName;
        tankClass = tankClass == null ? "未知" : tankClass;
        tankTier = tankTier == null ? "" : tankTier;
        settlementConfidence = settlementConfidence == null
                ? DecodeConfidence.UNKNOWN : settlementConfidence;
        earlyDeathConfidence = earlyDeathConfidence == null
                ? DecodeConfidence.UNKNOWN : earlyDeathConfidence;
        weakOutputConfidence = weakOutputConfidence == null
                ? DecodeConfidence.UNKNOWN : weakOutputConfidence;
        deathInWindowConfidence = deathInWindowConfidence == null
                ? DecodeConfidence.UNKNOWN : deathInWindowConfidence;
    }
}

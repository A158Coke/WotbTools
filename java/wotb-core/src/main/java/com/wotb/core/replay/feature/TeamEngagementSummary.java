package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;

import java.util.List;

/**
 * 团队视角的一段连续交火及其可确定性复核的目标证据。
 *
 * @param focusedTargetAccountIds 同一窗口内被至少两名本队成员命中的目标
 * @param targetSwitchCount 本队连续伤害事件中目标账号发生变化的次数
 */
public record TeamEngagementSummary(
        float startTime,
        float endTime,
        List<Long> alliedAccountIds,
        List<Long> enemyAccountIds,
        int damageDealt,
        int damageReceived,
        List<Long> focusedTargetAccountIds,
        int targetSwitchCount,
        DecodeConfidence confidence
) {

    public TeamEngagementSummary {
        alliedAccountIds = alliedAccountIds == null
                ? List.of() : List.copyOf(alliedAccountIds);
        enemyAccountIds = enemyAccountIds == null
                ? List.of() : List.copyOf(enemyAccountIds);
        focusedTargetAccountIds = focusedTargetAccountIds == null
                ? List.of() : List.copyOf(focusedTargetAccountIds);
        confidence = confidence == null ? DecodeConfidence.UNKNOWN : confidence;
    }
}

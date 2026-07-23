package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.Vector3;

import java.util.List;

/**
 * 交火段摘要 —— 一段连续交火过程的压缩信息。
 *
 * @param startTime            交火开始时间
 * @param endTime              交火结束时间
 * @param alliedAccountIds     本时段参与交火的己方账号
 * @param enemyAccountIds      本时段参与交火的敌方账号
 * @param damageDealt          本时段造成伤害
 * @param damageReceived       本时段承受伤害
 * @param recorderStartPosition 录像者在本段起始位置
 * @param recorderEndPosition   录像者在本段结束位置
 * @param outcome              交火结果
 * @param confidence           分析置信度
 */
public record EngagementSummary(
        float startTime,
        float endTime,
        List<Long> alliedAccountIds,
        List<Long> enemyAccountIds,
        int damageDealt,
        int damageReceived,
        Vector3 recorderStartPosition,
        Vector3 recorderEndPosition,
        EngagementOutcome outcome,
        DecodeConfidence confidence
) {

    public enum EngagementOutcome {
        UNKNOWN,
        FAVORABLE,
        UNFAVORABLE,
        EVEN
    }
}

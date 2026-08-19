package com.wotb.web.hundred.dto;

import java.time.OffsetDateTime;

/**
 * 百场公开排行榜行（API 纯英文 key）。只展示审核通过的 approved 快照；
 * 不暴露 userId / gameId snapshot / claimed 数据 / proof。
 * rank 为 query-time 派生的 competition ranking（1,2,2,4），不落库。
 */
public record HundredLeaderboardItemDto(
        Long id,
        Integer rank,
        long vehicleId,
        String vehicleName,
        String nickname,
        int approvedAverageDamage,
        int approvedBattleCount,
        OffsetDateTime approvedAt
) {
}

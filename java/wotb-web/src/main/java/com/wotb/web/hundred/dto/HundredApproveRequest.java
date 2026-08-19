package com.wotb.web.hundred.dto;

/**
 * 管理后台 APPROVE 请求：管理员最终确认值（排行榜只读 approved*）。
 */
public record HundredApproveRequest(
        int approvedAverageDamage,
        int approvedBattleCount
) {
}

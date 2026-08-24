package com.wotb.web.hundred.dto;

/** WG 自动认证提交只接受车辆与 claimed 审计值，不接受账号 ID、区服、截图或回放。 */
public record HundredWargamingSubmissionRequest(
        long vehicleId,
        int averageDamage,
        int battleCount
) {
}

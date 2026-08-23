package com.wotb.web.hundred.gateway;

/** 提交时从 WG 官方 API 冻结的账号与单车 totals（不含用户输入）。 */
public record WargamingOfficialStats(
        String server,
        long accountId,
        String nickname,
        long accountBattleCount,
        long vehicleId,
        long tankBattleCount,
        long tankDamageDealt
) {
}

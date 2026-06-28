package com.wotb.web.boost.dto;

/** 玩家创建陪练需求请求。 */
public record CreateBoostRequestRequest(
    Long playerAccountId,
    String playerNickname,
    String region,
    String requestType,
    String targetDescription,
    String budgetRange,
    String contactType,
    String contactValue,
    String availableTime,
    String remark
) {}

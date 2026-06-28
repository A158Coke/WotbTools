package com.wotb.web.user.dto;

/** 更新 WoTB 账号请求。 */
public record UpdateWotbAccountRequest(
    Long wotbAccountId,
    String wotbNickname,
    String wotbServer
) {}

package com.wotb.web.user.dto;

public record UpdateWotbAccountRequest(
    Long wotbAccountId,
    String wotbNickname,
    String wotbServer
) {}

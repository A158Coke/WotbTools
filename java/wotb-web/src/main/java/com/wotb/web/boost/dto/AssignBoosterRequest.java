package com.wotb.web.boost.dto;

/** 分配打手请求。 */
public record AssignBoosterRequest(
    Long boosterId,
    String note
) {}

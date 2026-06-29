package com.wotb.web.boost.dto;

/** 更新需求状态请求。 */
public record UpdateBoostRequestStatusRequest(
    String status,
    String adminNote
) {}

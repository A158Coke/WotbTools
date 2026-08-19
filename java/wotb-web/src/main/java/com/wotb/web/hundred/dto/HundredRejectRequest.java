package com.wotb.web.hundred.dto;

/**
 * 管理后台 REJECT 请求：原因强制（OTHER 时必须填写文本）。
 */
public record HundredRejectRequest(
        String rejectReason,
        String rejectReasonText
) {
}

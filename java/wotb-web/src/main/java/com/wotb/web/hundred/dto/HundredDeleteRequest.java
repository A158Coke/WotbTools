package com.wotb.web.hundred.dto;

/**
 * 管理后台删除 CURRENT 请求：原因强制（OTHER 时必须填写文本）。
 */
public record HundredDeleteRequest(
        String deleteReason,
        String deleteReasonText
) {
}

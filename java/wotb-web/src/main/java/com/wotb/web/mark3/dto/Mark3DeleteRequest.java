package com.wotb.web.mark3.dto;

/** 管理后台删除 CURRENT 三环记录的原因；OTHER 必须附文本。 */
public record Mark3DeleteRequest(
        String deleteReason,
        String deleteReasonText
) {
}

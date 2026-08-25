package com.wotb.web.mark3.dto;

/** 管理后台拒绝三环申请的原因；OTHER 必须附文本。 */
public record Mark3RejectRequest(
        String rejectReason,
        String rejectReasonText
) {
}

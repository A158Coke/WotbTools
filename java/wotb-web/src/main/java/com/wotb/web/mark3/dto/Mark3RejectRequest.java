package com.wotb.web.mark3.dto;

public record Mark3RejectRequest(
        String rejectReason,
        String rejectReasonText
) {
}

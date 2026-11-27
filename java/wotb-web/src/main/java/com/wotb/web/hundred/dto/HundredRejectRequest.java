package com.wotb.web.hundred.dto;

public record HundredRejectRequest(
    String rejectReason,
    String rejectReasonText
) {
}

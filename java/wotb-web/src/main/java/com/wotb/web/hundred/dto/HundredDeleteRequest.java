package com.wotb.web.hundred.dto;

public record HundredDeleteRequest(
    String deleteReason,
    String deleteReasonText
) {
}

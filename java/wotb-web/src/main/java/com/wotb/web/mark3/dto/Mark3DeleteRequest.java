package com.wotb.web.mark3.dto;

public record Mark3DeleteRequest(
        String deleteReason,
        String deleteReasonText
) {
}

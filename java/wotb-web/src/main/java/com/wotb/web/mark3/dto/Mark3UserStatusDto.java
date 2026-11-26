package com.wotb.web.mark3.dto;

import java.util.List;

public record Mark3UserStatusDto(
        List<Mark3SubmissionSummaryDto> current,
        List<Mark3SubmissionSummaryDto> pending,
        List<Mark3SubmissionSummaryDto> rejected
) {
}

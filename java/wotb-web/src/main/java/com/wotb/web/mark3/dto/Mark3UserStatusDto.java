package com.wotb.web.mark3.dto;

import java.util.List;

/** 个人中心三环状态：CURRENT、PENDING 与最近 REJECTED。 */
public record Mark3UserStatusDto(
        List<Mark3SubmissionSummaryDto> current,
        List<Mark3SubmissionSummaryDto> pending,
        List<Mark3SubmissionSummaryDto> rejected
) {
}

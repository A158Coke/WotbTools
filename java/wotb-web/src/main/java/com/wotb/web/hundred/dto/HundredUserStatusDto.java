package com.wotb.web.hundred.dto;

import java.util.List;

public record HundredUserStatusDto(
    List<HundredSubmissionSummaryDto> current,
    List<HundredSubmissionSummaryDto> pending,
    List<HundredSubmissionSummaryDto> rejected
) {
}

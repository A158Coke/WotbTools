package com.wotb.web.hundred.dto;

import java.util.List;

/**
 * 个人中心百场状态：当前有效纪录 + 当前 PENDING + 最近拒绝反馈。
 */
public record HundredUserStatusDto(
        List<HundredSubmissionSummaryDto> current,
        List<HundredSubmissionSummaryDto> pending,
        List<HundredSubmissionSummaryDto> rejected
) {
}

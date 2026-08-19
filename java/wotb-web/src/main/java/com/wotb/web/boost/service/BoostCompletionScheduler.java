package com.wotb.web.boost.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;

/** 定期关闭超过客户确认期限的陪练订单。 */
@Component
public class BoostCompletionScheduler {

    private static final Logger log = LoggerFactory.getLogger(BoostCompletionScheduler.class);

    private final BoostAssignmentService assignmentService;

    public BoostCompletionScheduler(final BoostAssignmentService assignmentService) {
        this.assignmentService = assignmentService;
    }

    @Scheduled(fixedDelayString = "${wotb.boost.auto-confirm-scan-ms}")
    public void autoConfirmExpired() {
        final OffsetDateTime now = OffsetDateTime.now();
        final int completed = assignmentService.findDueAutoConfirmRequestIds(now)
                .stream()
                .mapToInt(requestId -> autoConfirmOne(requestId, now))
                .sum();
        if (completed > 0) {
            log.info("Auto-confirmed {} boost requests", completed);
        }
    }

    private int autoConfirmOne(final Long requestId, final OffsetDateTime now) {
        try {
            return assignmentService.autoConfirmExpiredRequest(requestId, now) ? 1 : 0;
        } catch (final RuntimeException e) {
            log.error("Failed to auto-confirm boost request {}", requestId, e);
            return 0;
        }
    }
}

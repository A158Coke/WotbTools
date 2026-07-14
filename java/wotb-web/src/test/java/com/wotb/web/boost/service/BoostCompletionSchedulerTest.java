package com.wotb.web.boost.service;

import org.junit.jupiter.api.Test;

import java.time.OffsetDateTime;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class BoostCompletionSchedulerTest {

    @Test
    void shouldContinueAfterOneRequestFails() {
        final BoostAssignmentService assignmentService = mock(BoostAssignmentService.class);
        when(assignmentService.findDueAutoConfirmRequestIds(any(OffsetDateTime.class)))
                .thenReturn(List.of(1L, 2L));
        when(assignmentService.autoConfirmExpiredRequest(eq(1L), any(OffsetDateTime.class)))
                .thenThrow(new IllegalStateException("NO_ACTIVE_ASSIGNMENT"));
        when(assignmentService.autoConfirmExpiredRequest(eq(2L), any(OffsetDateTime.class)))
                .thenReturn(true);
        final BoostCompletionScheduler scheduler = new BoostCompletionScheduler(assignmentService);

        scheduler.autoConfirmExpired();

        verify(assignmentService).autoConfirmExpiredRequest(eq(1L), any(OffsetDateTime.class));
        verify(assignmentService).autoConfirmExpiredRequest(eq(2L), any(OffsetDateTime.class));
    }
}

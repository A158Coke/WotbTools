package com.wotb.web.boost.service;

import com.wotb.web.boost.entity.BoostRequest;
import com.wotb.web.boost.enums.BoostRequestStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AdminBoostRequestServiceTest {

    @Mock
    BoostRequestService requestService;

    @Mock
    BoostAssignmentService assignmentService;

    @Mock
    AdminBoostRequestMapper mapper;

    AdminBoostRequestService service;

    @BeforeEach
    void setUp() {
        service = new AdminBoostRequestService(requestService, assignmentService, mapper);
    }

    @Test
    void shouldNotReopenClosedRequest() {
        final BoostRequest req = request("CLOSED");
        when(requestService.getByIdForUpdate(100L)).thenReturn(req);

        assertThatThrownBy(() -> service.updateStatus(100L, "EXCEPTION", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("REQUEST_STATUS_TRANSITION_INVALID");

        verify(assignmentService, never()).syncActiveAssignmentForRequestStatus(
                req, BoostRequestStatus.CLOSED, BoostRequestStatus.EXCEPTION, null
        );
    }

    @Test
    void shouldRejectPendingConfirmToReviewingTransition() {
        final BoostRequest req = request("PENDING_CONFIRM");
        when(requestService.getByIdForUpdate(100L)).thenReturn(req);

        assertThatThrownBy(() -> service.updateStatus(100L, "REVIEWING", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("REQUEST_STATUS_TRANSITION_INVALID");

        assertThat(req.getStatus()).isEqualTo("PENDING_CONFIRM");
    }

    @Test
    void shouldApplyAllowedMatchedToExceptionTransition() {
        final BoostRequest req = request("MATCHED");
        when(requestService.getByIdForUpdate(100L)).thenReturn(req);

        service.updateStatus(100L, "EXCEPTION", "investigating");

        assertThat(req.getStatus()).isEqualTo("EXCEPTION");
        assertThat(req.getAdminNote()).isEqualTo("investigating");
        verify(assignmentService).syncActiveAssignmentForRequestStatus(
                req, BoostRequestStatus.MATCHED, BoostRequestStatus.EXCEPTION, "investigating"
        );
    }

    @Test
    void shouldDelegateClosedTransitionToSharedFinalizer() {
        final BoostRequest req = request("CLOSED");
        when(assignmentService.confirmByAdmin(100L, "done")).thenReturn(req);

        service.updateStatus(100L, "CLOSED", "done");

        verify(assignmentService).confirmByAdmin(100L, "done");
        verify(requestService, never()).getByIdForUpdate(100L);
    }

    private static BoostRequest request(final String status) {
        final BoostRequest req = new BoostRequest();
        req.setId(100L);
        req.setStatus(status);
        return req;
    }
}

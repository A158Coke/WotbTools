package com.wotb.web.boost.service;

import com.wotb.web.boost.entity.BoostRequest;
import com.wotb.web.boost.entity.BoostRequestAssignment;
import com.wotb.web.boost.entity.BoosterProfile;
import com.wotb.web.boost.repository.BoostRequestAssignmentRepository;
import com.wotb.web.user.service.UserNotificationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BoostAssignmentServiceTest {

    @Mock
    BoostRequestAssignmentRepository assignmentRepository;

    @Mock
    BoostRequestService requestService;

    @Mock
    BoostAssignmentMapper mapper;

    @Mock
    BoosterService boosterService;

    @Mock
    UserNotificationService notificationService;

    BoostAssignmentService service;

    private BoosterProfile activeBooster;

    @BeforeEach
    void setUp() {
        service = new BoostAssignmentService(
                assignmentRepository,
                requestService,
                boosterService,
                mapper,
                notificationService
        );
        activeBooster = new BoosterProfile();
        activeBooster.setId(1L);
        activeBooster.setKeycloakUserId("kc-booster");
        activeBooster.setStatus("ACTIVE");
        activeBooster.setAvailable(true);
    }

    @Test
    void shouldRejectAssignmentToInactiveBooster() {
        final BoostRequest req = request("NEW");
        activeBooster.setStatus("INACTIVE");
        when(requestService.getById(100L)).thenReturn(req);
        when(boosterService.getByIdForUpdate(1L)).thenReturn(activeBooster);

        assertThatThrownBy(() -> service.assign(100L, 1L, "note"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("BOOSTER_NOT_ACTIVE");
    }

    @Test
    void shouldRejectAssignmentToUnavailableBooster() {
        final BoostRequest req = request("NEW");
        activeBooster.setAvailable(false);
        when(requestService.getById(100L)).thenReturn(req);
        when(boosterService.getByIdForUpdate(1L)).thenReturn(activeBooster);

        assertThatThrownBy(() -> service.assign(100L, 1L, "note"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("BOOSTER_UNAVAILABLE");
    }

    @Test
    void shouldRejectAssignmentWhenRequestAlreadyMatched() {
        final BoostRequest req = request("MATCHED");
        when(requestService.getById(100L)).thenReturn(req);

        assertThatThrownBy(() -> service.assign(100L, 1L, "note"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("REQUEST_STATUS_NOT_ASSIGNABLE");
    }

    @Test
    void shouldRejectAssignmentToBusyBooster() {
        final BoostRequest req = request("NEW");
        when(requestService.getById(100L)).thenReturn(req);
        when(boosterService.getByIdForUpdate(1L)).thenReturn(activeBooster);
        when(assignmentRepository.countByBoosterIdAndUnassignedAtIsNull(1L)).thenReturn(1L);

        assertThatThrownBy(() -> service.assign(100L, 1L, "note"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("BOOSTER_BUSY");
    }

    @Test
    void shouldMoveAssignmentThroughBoosterWorkflow() {
        final BoostRequestAssignment assignment = assignment("ASSIGNED");
        final BoostRequest req = request("MATCHED");
        when(assignmentRepository.findByIdAndBoosterIdAndUnassignedAtIsNull(9L, 1L))
                .thenReturn(Optional.of(assignment));
        when(requestService.getById(100L)).thenReturn(req);
        when(boosterService.getById(1L)).thenReturn(activeBooster);

        service.acceptByBooster(9L, 1L);
        assertThat(assignment.getStatus()).isEqualTo("ACCEPTED");
        assertThat(req.getStatus()).isEqualTo("ACCEPTED");

        service.startByBooster(9L, 1L);
        assertThat(assignment.getStatus()).isEqualTo("IN_PROGRESS");
        assertThat(req.getStatus()).isEqualTo("IN_PROGRESS");

        service.completeByBooster(9L, 1L, "done");
        assertThat(assignment.getStatus()).isEqualTo("PENDING_CONFIRM");
        assertThat(req.getStatus()).isEqualTo("PENDING_CONFIRM");
        assertThat(assignment.getNote()).isEqualTo("done");
    }

    @Test
    void shouldReleaseBoosterWhenDecliningNewAssignment() {
        final BoostRequestAssignment assignment = assignment("ASSIGNED");
        final BoostRequest req = request("MATCHED");
        when(assignmentRepository.findByIdAndBoosterIdAndUnassignedAtIsNull(9L, 1L))
                .thenReturn(Optional.of(assignment));
        when(requestService.getById(100L)).thenReturn(req);
        when(boosterService.getById(1L)).thenReturn(activeBooster);

        service.declineByBooster(9L, 1L, "busy");

        assertThat(assignment.getStatus()).isEqualTo("DECLINED");
        assertThat(assignment.getUnassignedAt()).isNotNull();
        assertThat(req.getStatus()).isEqualTo("REVIEWING");
    }

    @Test
    void shouldFailUnassignWithoutActiveAssignment() {
        when(assignmentRepository.findByRequestIdAndUnassignedAtIsNull(100L))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.unassign(100L, "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("NO_ACTIVE_ASSIGNMENT");
    }

    private static BoostRequest request(final String status) {
        final BoostRequest req = new BoostRequest();
        req.setId(100L);
        req.setRequesterUserId("kc-requester");
        req.setStatus(status);
        req.setRequestType("COACHING");
        return req;
    }

    private static BoostRequestAssignment assignment(final String status) {
        final BoostRequestAssignment assignment = new BoostRequestAssignment();
        assignment.setId(9L);
        assignment.setRequestId(100L);
        assignment.setBoosterId(1L);
        assignment.setStatus(status);
        return assignment;
    }
}

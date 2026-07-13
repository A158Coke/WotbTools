package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.BoostAssignmentDto;
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

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
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

    @Test
    void shouldReturnOnlyActiveAssignmentsWhenHistoryDisabled() {
        final BoostRequestAssignment active = assignment("ASSIGNED");
        active.setAssignedAt(OffsetDateTime.parse("2026-07-09T12:00:00Z"));
        when(assignmentRepository.findByBoosterIdAndUnassignedAtIsNull(1L)).thenReturn(List.of(active));
        when(boosterService.getById(1L)).thenReturn(activeBooster);
        when(requestService.getById(100L)).thenReturn(request("MATCHED"));
        when(mapper.toDto(any(BoostRequestAssignment.class), any(BoosterProfile.class), any(BoostRequest.class)))
                .thenAnswer(invocation -> dto(invocation.getArgument(0)));

        final List<BoostAssignmentDto> result = service.findByBooster(1L, false);

        assertThat(result).extracting(BoostAssignmentDto::id).containsExactly(9L);
    }

    @Test
    void shouldReturnActiveFirstAndThenHistoryWhenHistoryEnabled() {
        final BoostRequestAssignment completed = assignment(11L, 201L, "COMPLETED",
                OffsetDateTime.parse("2026-07-09T13:00:00Z"), OffsetDateTime.parse("2026-07-09T15:00:00Z"));
        final BoostRequestAssignment active = assignment(12L, 202L, "IN_PROGRESS",
                OffsetDateTime.parse("2026-07-09T12:00:00Z"), null);
        final BoostRequestAssignment cancelled = assignment(13L, 203L, "CANCELLED",
                OffsetDateTime.parse("2026-07-09T11:00:00Z"), OffsetDateTime.parse("2026-07-09T11:30:00Z"));
        when(assignmentRepository.findByBoosterIdOrderByAssignedAtDesc(1L))
                .thenReturn(List.of(completed, active, cancelled));
        when(boosterService.getById(1L)).thenReturn(activeBooster);
        when(requestService.getById(201L)).thenReturn(request("CLOSED"));
        when(requestService.getById(202L)).thenReturn(request("IN_PROGRESS"));
        when(requestService.getById(203L)).thenReturn(request("CANCELLED"));
        when(mapper.toDto(any(BoostRequestAssignment.class), any(BoosterProfile.class), any(BoostRequest.class)))
                .thenAnswer(invocation -> dto(invocation.getArgument(0)));

        final List<BoostAssignmentDto> result = service.findByBooster(1L, true);

        assertThat(result).extracting(BoostAssignmentDto::id).containsExactly(12L, 11L, 13L);
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

    private static BoostRequestAssignment assignment(final Long id,
                                                     final Long requestId,
                                                     final String status,
                                                     final OffsetDateTime assignedAt,
                                                     final OffsetDateTime unassignedAt) {
        final BoostRequestAssignment assignment = new BoostRequestAssignment();
        assignment.setId(id);
        assignment.setRequestId(requestId);
        assignment.setBoosterId(1L);
        assignment.setStatus(status);
        assignment.setAssignedAt(assignedAt);
        assignment.setUnassignedAt(unassignedAt);
        return assignment;
    }

    private static BoostAssignmentDto dto(final BoostRequestAssignment assignment) {
        return new BoostAssignmentDto(
                assignment.getId(),
                assignment.getRequestId(),
                null,
                assignment.getStatus(),
                null, null, null, null, null,
                null, null, null, null, null,
                assignment.getAssignedAt(),
                assignment.getUnassignedAt(),
                assignment.getNote(),
                assignment.getCreatedAt(),
                assignment.getUpdatedAt()
        );
    }
}

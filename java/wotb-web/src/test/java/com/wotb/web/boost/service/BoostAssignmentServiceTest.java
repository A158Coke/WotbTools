package com.wotb.web.boost.service;

import com.wotb.web.boost.entity.BoostRequest;
import com.wotb.web.boost.entity.BoosterProfile;
import com.wotb.web.boost.repository.BoostRequestAssignmentRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

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

    BoostAssignmentService service;

    private BoosterProfile activeBooster;

    @BeforeEach
    void setUp() {
        service = new BoostAssignmentService(assignmentRepository, requestService, boosterService, mapper);
        activeBooster = new BoosterProfile();
        activeBooster.setId(1L);
        activeBooster.setStatus("ACTIVE");
        activeBooster.setAvailable(true);
    }

    @Test
    void shouldRejectAssignmentToInactiveBooster() {
        final var req = new BoostRequest();
        req.setStatus("NEW");
        activeBooster.setStatus("INACTIVE");
        when(requestService.getById(100L)).thenReturn(req);
        when(boosterService.getById(1L)).thenReturn(activeBooster);

        assertThatThrownBy(() -> service.assign(100L, 1L, "note"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("打手当前状态不可接单");
    }

    @Test
    void shouldRejectAssignmentToUnavailableBooster() {
        final var req = new BoostRequest();
        req.setStatus("NEW");
        activeBooster.setAvailable(false);
        when(requestService.getById(100L)).thenReturn(req);
        when(boosterService.getById(1L)).thenReturn(activeBooster);

        assertThatThrownBy(() -> service.assign(100L, 1L, "note"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("打手不可用");
    }

    @Test
    void shouldRejectAssignmentWhenRequestAlreadyMatched() {
        final var req = new BoostRequest();
        req.setStatus("MATCHED");
        when(requestService.getById(100L)).thenReturn(req);

        assertThatThrownBy(() -> service.assign(100L, 1L, "note"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("当前状态不允许分配打手");
    }

    @Test
    void shouldFailUnassignWithoutActiveAssignment() {
        when(assignmentRepository.findByRequestIdAndUnassignedAtIsNull(100L))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.unassign(100L, "test"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("NO_ACTIVE_ASSIGNMENT");
    }
}

package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.BoostAssignmentDto;
import com.wotb.web.boost.entity.BoostRequest;
import com.wotb.web.boost.entity.BoostRequestAssignment;
import com.wotb.web.boost.entity.BoosterProfile;
import com.wotb.web.boost.enums.BoostAssignmentStatus;
import com.wotb.web.boost.enums.BoostRequestStatus;
import com.wotb.web.boost.repository.BoostRequestAssignmentRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

/** 分配服务。 */
@Service
public class BoostAssignmentService {

    private final BoostRequestAssignmentRepository assignmentRepository;
    private final BoostRequestService requestService;
    private final BoosterService boosterService;
    private final BoostAssignmentMapper mapper;

    public BoostAssignmentService(final BoostRequestAssignmentRepository assignmentRepository,
                                  final BoostRequestService requestService,
                                  final BoosterService boosterService,
                                  final BoostAssignmentMapper mapper) {
        this.assignmentRepository = assignmentRepository;
        this.requestService = requestService;
        this.boosterService = boosterService;
        this.mapper = mapper;
    }

    public Optional<BoostRequestAssignment> findActive(final Long requestId) {
        return assignmentRepository.findByRequestIdAndUnassignedAtIsNull(requestId);
    }

    @Transactional(readOnly = true)
    public List<BoostAssignmentDto> findByBooster(final Long boosterId) {
        return assignmentRepository.findByBoosterIdAndUnassignedAtIsNull(boosterId)
                .stream()
                .map(a -> mapper.toDto(a, boosterService.getById(a.getBoosterId())))
                .toList();
    }

    @Transactional
    public BoostAssignmentDto assign(final Long requestId, final Long boosterId, final String note) {
        if (assignmentRepository.findByRequestIdAndUnassignedAtIsNull(requestId).isPresent()) {
            throw new IllegalStateException("该需求已有一个活跃分配，请先取消当前分配");
        }

        final BoostRequest req = requestService.getById(requestId);
        final String status = req.getStatus().toUpperCase();
        if (!"NEW".equals(status) && !"REVIEWING".equals(status)) {
            throw new IllegalArgumentException("当前状态不允许分配打手");
        }

        final BoosterProfile booster = boosterService.getById(boosterId);
        if (booster.getAvailable() == null || !booster.getAvailable()) {
            throw new IllegalArgumentException("BOOSTER_NOT_AVAILABLE");
        }

        final OffsetDateTime now = OffsetDateTime.now();
        final BoostRequestAssignment assignment = new BoostRequestAssignment();
        assignment.setRequestId(requestId);
        assignment.setBoosterId(boosterId);
        assignment.setStatus(BoostAssignmentStatus.ASSIGNED.name());
        assignment.setAssignedAt(now);
        assignment.setUpdatedAt(now);
        assignment.setNote(note);
        assignmentRepository.save(assignment);

        req.setStatus(BoostRequestStatus.MATCHED.name());
        req.setUpdatedAt(now);

        return mapper.toDto(assignment, booster);
    }

    @Transactional
    public BoostAssignmentDto unassign(final Long requestId, final String note) {
        final BoostRequestAssignment assignment = assignmentRepository
                .findByRequestIdAndUnassignedAtIsNull(requestId)
                .orElseThrow(() -> new IllegalStateException("NO_ACTIVE_ASSIGNMENT"));

        final OffsetDateTime now = OffsetDateTime.now();
        assignment.setUnassignedAt(now);
        assignment.setStatus(BoostAssignmentStatus.CANCELLED.name());
        assignment.setNote(note);
        assignment.setUpdatedAt(now);
        assignmentRepository.save(assignment);

        final BoostRequest req = requestService.getById(requestId);
        if ("MATCHED".equalsIgnoreCase(req.getStatus())) {
            req.setStatus(BoostRequestStatus.REVIEWING.name());
            req.setUpdatedAt(now);
        }

        final BoosterProfile booster = boosterService.getById(assignment.getBoosterId());
        return mapper.toDto(assignment, booster);
    }
}

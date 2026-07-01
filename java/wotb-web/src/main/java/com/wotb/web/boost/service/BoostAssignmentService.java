package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.BoostAssignmentDto;
import com.wotb.web.boost.dto.BoosterSummaryDto;
import com.wotb.web.boost.entity.BoostRequest;
import com.wotb.web.boost.entity.BoostRequestAssignment;
import com.wotb.web.boost.entity.BoosterProfile;
import com.wotb.web.boost.enums.BoostAssignmentStatus;
import com.wotb.web.boost.enums.BoostRequestStatus;
import com.wotb.web.boost.enums.BoosterLevel;
import com.wotb.web.boost.enums.BoosterStatus;
import com.wotb.web.boost.repository.BoostRequestAssignmentRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Optional;

/** 分配服务。 */
@Service
public class BoostAssignmentService {

    private final BoostRequestAssignmentRepository assignmentRepository;
    private final BoostRequestService requestService;
    private final BoosterService boosterService;

    public BoostAssignmentService(final BoostRequestAssignmentRepository assignmentRepository,
                                  final BoostRequestService requestService,
                                  final BoosterService boosterService) {
        this.assignmentRepository = assignmentRepository;
        this.requestService = requestService;
        this.boosterService = boosterService;
    }

    public Optional<BoostRequestAssignment> findActive(final Long requestId) {
        return assignmentRepository.findByRequestIdAndUnassignedAtIsNull(requestId);
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

        return toDto(assignment, booster);
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
        return toDto(assignment, booster);
    }

    public long activeCount(final Long boosterId) {
        return assignmentRepository.countByBoosterIdAndUnassignedAtIsNull(boosterId);
    }

    static BoostAssignmentDto toDto(final BoostRequestAssignment a, final BoosterProfile b) {
        return new BoostAssignmentDto(
                a.getId(), a.getRequestId(),
                new BoosterSummaryDto(b.getId(), b.getNickname(), b.getLevel(),
                        BoosterLevel.from(b.getLevel()).label(),
                        b.getAvailable(), b.getStatus(), BoosterStatus.from(b.getStatus()).label()),
                a.getStatus(), BoostAssignmentStatus.from(a.getStatus()).label(),
                a.getAssignedAt(), a.getUnassignedAt(), a.getNote(),
                a.getCreatedAt(), a.getUpdatedAt()
        );
    }
}

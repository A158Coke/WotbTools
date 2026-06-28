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
import com.wotb.web.boost.repository.BoostRequestRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Optional;

/** 分配服务。 */
@Service
public class BoostAssignmentService {

    private final BoostRequestAssignmentRepository assignmentRepository;
    private final BoostRequestRepository requestRepository;
    private final BoosterService boosterService;

    public BoostAssignmentService(final BoostRequestAssignmentRepository assignmentRepository,
                                  final BoostRequestRepository requestRepository,
                                  final BoosterService boosterService) {
        this.assignmentRepository = assignmentRepository;
        this.requestRepository = requestRepository;
        this.boosterService = boosterService;
    }

    public Optional<BoostRequestAssignment> findActive(final Long requestId) {
        return assignmentRepository.findByRequestIdAndUnassignedAtIsNull(requestId);
    }

    /** 分配打手 + 更新需求状态为 MATCHED。同一事务。 */
    @Transactional
    public BoostAssignmentDto assign(final Long requestId, final Long boosterId, final String note) {
        if (assignmentRepository.findByRequestIdAndUnassignedAtIsNull(requestId).isPresent()) {
            throw new IllegalStateException("ACTIVE_ASSIGNMENT_EXISTS");
        }

        // 仅允许 NEW / REVIEWING 状态分配打手
        final BoostRequest req = requestRepository.findById(requestId)
                .orElseThrow(() -> new IllegalArgumentException("REQUEST_NOT_FOUND"));
        final String status = req.getStatus().toUpperCase();
        if (!"NEW".equals(status) && !"REVIEWING".equals(status)) {
            throw new IllegalArgumentException("当前状态不允许分配打手");
        }

        final BoosterProfile booster = boosterService.getById(boosterId);
        if (!"ACTIVE".equalsIgnoreCase(booster.getStatus())) {
            throw new IllegalArgumentException("BOOSTER_NOT_AVAILABLE");
        }

        final BoostRequestAssignment assignment = new BoostRequestAssignment();
        assignment.setRequestId(requestId);
        assignment.setBoosterId(boosterId);
        assignment.setStatus(BoostAssignmentStatus.ASSIGNED.name());
        assignment.setAssignedAt(OffsetDateTime.now());
        assignment.setNote(note);
        assignmentRepository.save(assignment);

        // 更新需求状态（复用上方已查找的 req）
        req.setStatus(BoostRequestStatus.MATCHED.name());
        req.setUpdatedAt(OffsetDateTime.now());
        requestRepository.save(req);

        return toDto(assignment, booster);
    }

    /** 取消分配 + 回退需求状态。同一事务。 */
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

        // 如果需求状态为 MATCHED，回退到 REVIEWING
        final BoostRequest req = requestRepository.findById(requestId)
                .orElseThrow(() -> new IllegalArgumentException("REQUEST_NOT_FOUND"));
        if ("MATCHED".equalsIgnoreCase(req.getStatus())) {
            req.setStatus(BoostRequestStatus.REVIEWING.name());
            req.setUpdatedAt(OffsetDateTime.now());
            requestRepository.save(req);
        }

        final BoosterProfile booster = boosterService.getById(assignment.getBoosterId());
        return toDto(assignment, booster);
    }

    public long activeCount(final Long boosterId) {
        return assignmentRepository.countByBoosterIdAndUnassignedAtIsNull(boosterId);
    }

    static BoostAssignmentDto toDto(final BoostRequestAssignment a, final BoosterProfile b) {
        return new BoostAssignmentDto(
                a.getId(),
                a.getRequestId(),
                new BoosterSummaryDto(
                        b.getId(),
                        b.getNickname(),
                        b.getLevel(),
                        BoosterLevel.from(b.getLevel()).label(),
                        b.getAvailable(),
                        b.getStatus(),
                        BoosterStatus.from(b.getStatus()).label()
                ),
                a.getStatus(),
                BoostAssignmentStatus.from(a.getStatus()).label(),
                a.getAssignedAt(),
                a.getUnassignedAt(),
                a.getNote(),
                a.getCreatedAt(),
                a.getUpdatedAt()
        );
    }
}

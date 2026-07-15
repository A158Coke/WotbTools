package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.AdminBoostRequestDto;
import com.wotb.web.boost.entity.BoostRequest;
import com.wotb.web.boost.enums.BoostRequestStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 管理员侧需求服务。
 * DTO 转换委托给 AdminBoostRequestMapper。
 */
@Service
public class AdminBoostRequestService {

    private static final Set<BoostRequestStatus> ADMIN_TARGET_STATUSES = Set.of(
            BoostRequestStatus.REVIEWING,
            BoostRequestStatus.REJECTED,
            BoostRequestStatus.CANCELLED,
            BoostRequestStatus.CLOSED,
            BoostRequestStatus.EXCEPTION
    );
    private static final Map<BoostRequestStatus, Set<BoostRequestStatus>> ADMIN_TRANSITIONS = Map.of(
            BoostRequestStatus.NEW, Set.of(BoostRequestStatus.REVIEWING, BoostRequestStatus.REJECTED),
            BoostRequestStatus.REVIEWING, Set.of(BoostRequestStatus.REJECTED, BoostRequestStatus.CANCELLED),
            BoostRequestStatus.MATCHED, Set.of(BoostRequestStatus.EXCEPTION, BoostRequestStatus.CANCELLED),
            BoostRequestStatus.ACCEPTED, Set.of(BoostRequestStatus.EXCEPTION, BoostRequestStatus.CANCELLED),
            BoostRequestStatus.IN_PROGRESS, Set.of(BoostRequestStatus.EXCEPTION, BoostRequestStatus.CANCELLED),
            BoostRequestStatus.PENDING_CONFIRM, Set.of(BoostRequestStatus.EXCEPTION),
            BoostRequestStatus.EXCEPTION, Set.of(BoostRequestStatus.CANCELLED)
    );

    private final BoostRequestService requestService;
    private final BoostAssignmentService assignmentService;
    private final AdminBoostRequestMapper boostRequestMapper;

    public AdminBoostRequestService(final BoostRequestService requestService,
                                    final BoostAssignmentService assignmentService,
                                    final AdminBoostRequestMapper boostRequestMapper) {
        this.requestService = requestService;
        this.assignmentService = assignmentService;
        this.boostRequestMapper = boostRequestMapper;
    }

    public Page<AdminBoostRequestDto> list(final String status, final Pageable pageable) {
        final Page<BoostRequest> page;
        if (StringUtils.hasText(status)) {
            page = requestService.findByStatus(status, pageable);
        } else {
            page = requestService.findAll(pageable);
        }
        return page.map(boostRequestMapper::toDto);
    }

    public Optional<AdminBoostRequestDto> get(final Long id) {
        return Optional.of(requestService.getById(id)).map(boostRequestMapper::toDto);
    }

    @Transactional
    public AdminBoostRequestDto updateStatus(final Long id, final String status, final String adminNote) {
        final BoostRequestStatus targetStatus = BoostRequestStatus.from(status);
        if (!ADMIN_TARGET_STATUSES.contains(targetStatus)) {
            throw new IllegalArgumentException("REQUEST_STATUS_NOT_ADMIN_MUTABLE");
        }
        if (targetStatus == BoostRequestStatus.CLOSED) {
            return boostRequestMapper.toDto(assignmentService.confirmByAdmin(id, adminNote));
        }

        final BoostRequest req = requestService.getByIdForUpdate(id);
        final BoostRequestStatus currentStatus = BoostRequestStatus.from(req.getStatus());
        if (currentStatus == targetStatus) {
            if (adminNote != null) {
                req.setAdminNote(adminNote);
                req.setUpdatedAt(OffsetDateTime.now());
            }
            return boostRequestMapper.toDto(req);
        }
        if (!ADMIN_TRANSITIONS.getOrDefault(currentStatus, Set.of()).contains(targetStatus)) {
            throw new IllegalArgumentException("REQUEST_STATUS_TRANSITION_INVALID");
        }

        req.setStatus(targetStatus.name());
        if (adminNote != null) {
            req.setAdminNote(adminNote);
        }
        req.setUpdatedAt(OffsetDateTime.now());

        assignmentService.syncActiveAssignmentForRequestStatus(req, currentStatus, targetStatus, adminNote);

        return boostRequestMapper.toDto(req);
    }
}

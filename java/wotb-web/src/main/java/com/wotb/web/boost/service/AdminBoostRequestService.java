package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.AdminBoostRequestDto;
import com.wotb.web.boost.entity.BoostRequest;
import com.wotb.web.boost.enums.BoostAssignmentStatus;
import com.wotb.web.boost.enums.BoostRequestStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.OffsetDateTime;
import java.util.Optional;

/**
 * 管理员侧需求服务。
 * DTO 转换委托给 AdminBoostRequestMapper。
 */
@Service
public class AdminBoostRequestService {

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
        final BoostRequest req = requestService.getById(id);

        BoostRequestStatus.from(status);
        final String upper = status.toUpperCase();
        req.setStatus(upper);
        if (adminNote != null) req.setAdminNote(adminNote);
        req.setUpdatedAt(OffsetDateTime.now());

        if ("CANCELLED".equals(upper) || "CLOSED".equals(upper) || "REJECTED".equals(upper)) {
            assignmentService.findActive(id).ifPresent(a -> {
                a.setUnassignedAt(OffsetDateTime.now());
                a.setStatus(BoostAssignmentStatus.CANCELLED.name());
                a.setUpdatedAt(OffsetDateTime.now());
            });
        }

        return boostRequestMapper.toDto(req);
    }
}

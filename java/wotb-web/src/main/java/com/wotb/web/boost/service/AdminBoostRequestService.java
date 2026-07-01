package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.AdminBoostRequestDto;
import com.wotb.web.boost.dto.BoostAssignmentDto;
import com.wotb.web.boost.dto.BoosterSummaryDto;
import com.wotb.web.boost.entity.BoostRequest;
import com.wotb.web.boost.entity.BoostRequestAssignment;
import com.wotb.web.boost.entity.BoosterProfile;
import com.wotb.web.boost.enums.BoostAssignmentStatus;
import com.wotb.web.boost.enums.BoostRegion;
import com.wotb.web.boost.enums.BoostRequestStatus;
import com.wotb.web.boost.enums.BoostRequestType;
import com.wotb.web.boost.enums.BoosterLevel;
import com.wotb.web.boost.enums.BoosterStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Optional;

/**
 * 管理员侧需求服务。
 * 跨域查询通过 BoostRequestService / BoostAssignmentService / BoosterService。
 */
@Service
public class AdminBoostRequestService {

    private final BoostRequestService requestService;
    private final BoostAssignmentService assignmentService;
    private final BoosterService boosterService;

    public AdminBoostRequestService(final BoostRequestService requestService,
                                    final BoostAssignmentService assignmentService,
                                    final BoosterService boosterService) {
        this.requestService = requestService;
        this.assignmentService = assignmentService;
        this.boosterService = boosterService;
    }

    public Page<AdminBoostRequestDto> list(final String status, final Pageable pageable) {
        final Page<BoostRequest> page;
        if (status != null && !status.isBlank()) {
            page = requestService.findByStatus(status, pageable);
        } else {
            page = requestService.findAll(pageable);
        }
        return page.map(this::toAdminDto);
    }

    public Optional<AdminBoostRequestDto> get(final Long id) {
        return Optional.of(requestService.getById(id)).map(this::toAdminDto);
    }

    @Transactional
    public AdminBoostRequestDto updateStatus(final Long id, final String status, final String adminNote) {
        final BoostRequest req = requestService.getById(id);

        BoostRequestStatus.from(status);
        final String upper = status.toUpperCase();

        // 终态 (CANCELLED/CLOSED/REJECTED): 自动清理活跃分配
        if ("CANCELLED".equals(upper) || "CLOSED".equals(upper) || "REJECTED".equals(upper)) {
            assignmentService.findActive(id).ifPresent(a -> {
                a.setUnassignedAt(OffsetDateTime.now());
                a.setStatus(BoostAssignmentStatus.CANCELLED.name());
                a.setUpdatedAt(OffsetDateTime.now());
                // assignment entity is managed within the current transaction
            });
        }

        req.setStatus(upper);
        if (adminNote != null) {
            req.setAdminNote(adminNote);
        }
        req.setUpdatedAt(OffsetDateTime.now());
        // req is managed by JPA; changes flushed at transaction commit

        return toAdminDto(req);
    }

    private AdminBoostRequestDto toAdminDto(final BoostRequest req) {
        final Optional<BoostRequestAssignment> active = assignmentService.findActive(req.getId());

        BoostAssignmentDto current = null;
        if (active.isPresent()) {
            final BoostRequestAssignment a = active.get();
            final BoosterProfile b = boosterService.getById(a.getBoosterId());
            current = new BoostAssignmentDto(
                    a.getId(),
                    a.getRequestId(),
                    new BoosterSummaryDto(
                            b.getId(),
                            b.getNickname(),
                            b.getLevel(),
                            BoosterLevel.from(b.getLevel()).label(),
                            b.getKeycloakUserId(),
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

        return new AdminBoostRequestDto(
                req.getId(),
                req.getRequesterUserId(),
                req.getWotbAccountId(),
                req.getPlayerAccountId(),
                req.getPlayerNickname(),
                req.getRegion(),
                BoostRegion.from(req.getRegion()).label(),
                req.getRequestType(),
                BoostRequestType.from(req.getRequestType()).label(),
                req.getTargetDescription(),
                req.getBudgetRange(),
                req.getContactType(),
                req.getContactValue(),
                req.getAvailableTime(),
                req.getRemark(),
                req.getStatus(),
                BoostRequestStatus.from(req.getStatus()).label(),
                req.getAdminNote(),
                current,
                req.getCreatedAt(),
                req.getUpdatedAt()
        );
    }
}

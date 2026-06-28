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
import com.wotb.web.boost.repository.BoostRequestAssignmentRepository;
import com.wotb.web.boost.repository.BoostRequestRepository;
import com.wotb.web.boost.repository.BoosterProfileRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Optional;

/** 管理员侧需求服务。 */
@Service
public class AdminBoostRequestService {

    private final BoostRequestRepository repository;
    private final BoostRequestAssignmentRepository assignmentRepository;
    private final BoosterProfileRepository boosterRepository;

    public AdminBoostRequestService(final BoostRequestRepository repository,
                                    final BoostRequestAssignmentRepository assignmentRepository,
                                    final BoosterProfileRepository boosterRepository) {
        this.repository = repository;
        this.assignmentRepository = assignmentRepository;
        this.boosterRepository = boosterRepository;
    }

    public Page<AdminBoostRequestDto> list(final String status, final Pageable pageable) {
        final Page<BoostRequest> page;
        if (status != null && !status.isBlank()) {
            page = repository.findByStatus(status, pageable);
        } else {
            page = repository.findAll(pageable);
        }
        return page.map(this::toAdminDto);
    }

    public Optional<AdminBoostRequestDto> get(final Long id) {
        return repository.findById(id).map(this::toAdminDto);
    }

    @Transactional
    public AdminBoostRequestDto updateStatus(final Long id, final String status, final String adminNote) {
        final BoostRequest req = repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("REQUEST_NOT_FOUND"));

        BoostRequestStatus.from(status);

        req.setStatus(status.toUpperCase());
        if (adminNote != null) {
            req.setAdminNote(adminNote);
        }
        req.setUpdatedAt(OffsetDateTime.now());

        repository.save(req);
        return toAdminDto(req);
    }

    private AdminBoostRequestDto toAdminDto(final BoostRequest req) {
        final Optional<BoostRequestAssignment> active = assignmentRepository
                .findByRequestIdAndUnassignedAtIsNull(req.getId());

        BoostAssignmentDto current = null;
        if (active.isPresent()) {
            final BoostRequestAssignment a = active.get();
            final BoosterProfile b = boosterRepository.findById(a.getBoosterId()).orElse(null);
            if (b != null) {
                current = new BoostAssignmentDto(
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

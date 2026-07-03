package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.AdminBoostRequestDto;
import com.wotb.web.boost.dto.BoostAssignmentDto;
import com.wotb.web.boost.entity.BoostRequest;
import com.wotb.web.boost.entity.BoostRequestAssignment;
import com.wotb.web.boost.entity.BoosterProfile;
import com.wotb.web.boost.enums.BoostRegion;
import com.wotb.web.boost.enums.BoostRequestStatus;
import com.wotb.web.boost.enums.BoostRequestType;
import org.springframework.stereotype.Service;

import java.util.Optional;

/** 需求 → Admin DTO 映射。含活跃分配查询。 */
@Service
public class AdminBoostRequestMapper {

    private final BoostAssignmentService assignmentService;
    private final BoosterService boosterService;
    private final BoostAssignmentMapper assignmentMapper;

    public AdminBoostRequestMapper(final BoostAssignmentService assignmentService,
                                   final BoosterService boosterService,
                                   final BoostAssignmentMapper assignmentMapper) {
        this.assignmentService = assignmentService;
        this.boosterService = boosterService;
        this.assignmentMapper = assignmentMapper;
    }

    public AdminBoostRequestDto toDto(final BoostRequest req) {
        final Optional<BoostRequestAssignment> active = assignmentService.findActive(req.getId());

        BoostAssignmentDto current = null;
        if (active.isPresent()) {
            final BoostRequestAssignment a = active.get();
            final BoosterProfile b = boosterService.getById(a.getBoosterId());
            current = assignmentMapper.toDto(a, b);
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

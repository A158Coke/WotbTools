package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.AdminBoostRequestDto;
import com.wotb.web.boost.dto.BoostAssignmentDto;
import com.wotb.web.boost.entity.BoostRequest;
import com.wotb.web.boost.entity.BoostRequestAssignment;
import com.wotb.web.boost.entity.BoosterProfile;
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
        final BoostAssignmentDto current = active
                .map(assignment -> {
                    final BoosterProfile booster = boosterService.getById(assignment.getBoosterId());
                    return assignmentMapper.toDto(assignment, booster);
                })
                .orElse(null);

        return new AdminBoostRequestDto(
                req.getId(),
                req.getRequesterUserId(),
                req.getWotbAccountId(),
                req.getPlayerAccountId(),
                req.getPlayerNickname(),
                req.getRegion(),
                req.getRequestType(),
                req.getTargetDescription(),
                req.getBudgetRange(),
                req.getContactType(),
                req.getContactValue(),
                req.getAvailableTime(),
                req.getRemark(),
                req.getStatus(),
                req.getAdminNote(),
                current,
                req.getCreatedAt(),
                req.getUpdatedAt()
        );
    }
}

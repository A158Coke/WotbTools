package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.BoostAssignmentDto;
import com.wotb.web.boost.dto.BoosterSummaryDto;
import com.wotb.web.boost.entity.BoostRequest;
import com.wotb.web.boost.entity.BoostRequestAssignment;
import com.wotb.web.boost.entity.BoosterProfile;
import org.springframework.stereotype.Service;

/** 双参映射（Assignment + Booster），不实现 Mapper<E,D> 单参接口。 */
@Service
public class BoostAssignmentMapper {

    public BoostAssignmentDto toDto(final BoostRequestAssignment assignment, final BoosterProfile booster) {
        return toDto(assignment, booster, null);
    }

    public BoostAssignmentDto toDto(final BoostRequestAssignment assignment,
                                    final BoosterProfile booster,
                                    final BoostRequest request) {
        final boolean hasRequest = request != null;
        return new BoostAssignmentDto(
                assignment.getId(), assignment.getRequestId(),
                toBoosterSummary(booster),
                assignment.getStatus(),
                hasRequest ? request.getRequestType() : null,
                hasRequest ? request.getTargetDescription() : null,
                hasRequest ? request.getStatus() : null,
                hasRequest ? request.getContactType() : null,
                hasRequest ? request.getContactValue() : null,
                hasRequest ? request.getAvailableTime() : null,
                hasRequest ? request.getPlayerNickname() : null,
                hasRequest ? request.getPlayerAccountId() : null,
                hasRequest ? request.getBudgetRange() : null,
                hasRequest ? request.getRemark() : null,
                assignment.getAssignedAt(), assignment.getUnassignedAt(), assignment.getNote(),
                assignment.getCreatedAt(), assignment.getUpdatedAt()
        );
    }

    private static BoosterSummaryDto toBoosterSummary(final BoosterProfile booster) {
        return new BoosterSummaryDto(booster.getId(), booster.getNickname(), booster.getLevel(),
                booster.getKeycloakUserId(), booster.getAvailable(), booster.getStatus());
    }
}

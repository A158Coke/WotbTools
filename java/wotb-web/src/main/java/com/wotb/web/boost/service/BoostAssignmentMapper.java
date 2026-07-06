package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.BoostAssignmentDto;
import com.wotb.web.boost.dto.BoosterSummaryDto;
import com.wotb.web.boost.entity.BoostRequest;
import com.wotb.web.boost.entity.BoostRequestAssignment;
import com.wotb.web.boost.entity.BoosterProfile;
import com.wotb.web.boost.enums.BoostAssignmentStatus;
import com.wotb.web.boost.enums.BoostRequestStatus;
import com.wotb.web.boost.enums.BoostRequestType;
import com.wotb.web.boost.enums.BoosterLevel;
import com.wotb.web.boost.enums.BoosterStatus;
import org.springframework.stereotype.Service;

/** 双参映射（Assignment + Booster），不实现 Mapper<E,D> 单参接口。 */
@Service
public class BoostAssignmentMapper {

    public BoostAssignmentDto toDto(final BoostRequestAssignment a, final BoosterProfile b) {
        return toDto(a, b, null);
    }

    public BoostAssignmentDto toDto(final BoostRequestAssignment a, final BoosterProfile b,
                                    final BoostRequest req) {
        final boolean hasRequest = req != null;
        return new BoostAssignmentDto(
                a.getId(), a.getRequestId(),
                toBoosterSummary(b),
                a.getStatus(), BoostAssignmentStatus.from(a.getStatus()).label(),
                hasRequest ? BoostRequestType.from(req.getRequestType()).label() : null,
                hasRequest ? req.getTargetDescription() : null,
                hasRequest ? req.getStatus() : null,
                hasRequest ? BoostRequestStatus.from(req.getStatus()).label() : null,
                hasRequest ? req.getContactType() : null,
                hasRequest ? req.getContactValue() : null,
                hasRequest ? req.getAvailableTime() : null,
                hasRequest ? req.getPlayerNickname() : null,
                hasRequest ? req.getPlayerAccountId() : null,
                hasRequest ? req.getBudgetRange() : null,
                hasRequest ? req.getRemark() : null,
                a.getAssignedAt(), a.getUnassignedAt(), a.getNote(),
                a.getCreatedAt(), a.getUpdatedAt()
        );
    }

    private static BoosterSummaryDto toBoosterSummary(final BoosterProfile b) {
        return new BoosterSummaryDto(b.getId(), b.getNickname(), b.getLevel(),
                BoosterLevel.from(b.getLevel()).label(), b.getKeycloakUserId(),
                b.getAvailable(), b.getStatus(), BoosterStatus.from(b.getStatus()).label());
    }
}

package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.BoostAssignmentDto;
import com.wotb.web.boost.dto.BoosterSummaryDto;
import com.wotb.web.boost.entity.BoostRequestAssignment;
import com.wotb.web.boost.entity.BoosterProfile;
import com.wotb.web.boost.enums.BoostAssignmentStatus;
import com.wotb.web.boost.enums.BoosterLevel;
import com.wotb.web.boost.enums.BoosterStatus;
import org.springframework.stereotype.Service;

/** 双参映射（Assignment + Booster），不实现 Mapper<E,D> 单参接口。 */
@Service
public class BoostAssignmentMapper {

    public BoostAssignmentDto toDto(final BoostRequestAssignment a, final BoosterProfile b) {
        return new BoostAssignmentDto(
                a.getId(), a.getRequestId(),
                new BoosterSummaryDto(b.getId(), b.getNickname(), b.getLevel(),
                        BoosterLevel.from(b.getLevel()).label(), b.getKeycloakUserId(),
                        b.getAvailable(), b.getStatus(), BoosterStatus.from(b.getStatus()).label()),
                a.getStatus(), BoostAssignmentStatus.from(a.getStatus()).label(),
                null, null,
                a.getAssignedAt(), a.getUnassignedAt(), a.getNote(),
                a.getCreatedAt(), a.getUpdatedAt()
        );
    }

    public BoostAssignmentDto toDto(final BoostRequestAssignment a, final BoosterProfile b,
                                    final String requestTypeLabel, final String targetDescription) {
        return new BoostAssignmentDto(
                a.getId(), a.getRequestId(),
                new BoosterSummaryDto(b.getId(), b.getNickname(), b.getLevel(),
                        BoosterLevel.from(b.getLevel()).label(), b.getKeycloakUserId(),
                        b.getAvailable(), b.getStatus(), BoosterStatus.from(b.getStatus()).label()),
                a.getStatus(), BoostAssignmentStatus.from(a.getStatus()).label(),
                requestTypeLabel, targetDescription,
                a.getAssignedAt(), a.getUnassignedAt(), a.getNote(),
                a.getCreatedAt(), a.getUpdatedAt()
        );
    }
}

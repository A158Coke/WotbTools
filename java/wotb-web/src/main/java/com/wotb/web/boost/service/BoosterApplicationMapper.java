package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.BoosterApplicationDto;
import com.wotb.web.boost.entity.BoosterApplication;
import com.wotb.web.util.Mapper;
import org.springframework.stereotype.Service;

@Service
public class BoosterApplicationMapper implements Mapper<BoosterApplication, BoosterApplicationDto> {

    @Override
    public BoosterApplicationDto toDto(final BoosterApplication application) {
        return new BoosterApplicationDto(
                application.getId(),
                application.getKeycloakUserId(),
                application.getUserProfileId(),
                application.getWotbAccountId(),
                application.getWotbNickname(),
                application.getWotbServer(),
                application.getOverallStatsImage(),
                application.getVehicleStatsImage(),
                application.getRequestedLevel(),
                application.getQq(),
                application.getWechat(),
                application.getAvailabilityTier(),
                application.getDailyTimeWindow(),
                application.getSelfAssessment(),
                application.getStatus(),
                application.getAdminNote(),
                application.getApprovedBoosterId(),
                application.getReviewedBy(),
                application.getReviewedAt(),
                application.getCreatedAt(),
                application.getUpdatedAt()
        );
    }
}

package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.BoosterDto;
import com.wotb.web.boost.entity.BoosterProfile;
import com.wotb.web.boost.enums.BoosterLevel;
import com.wotb.web.boost.enums.BoosterStatus;
import com.wotb.web.util.Mapper;
import org.springframework.stereotype.Service;

@Service
public class BoosterMapper implements Mapper<BoosterProfile, BoosterDto> {

    private final BoostStatsService statsService;

    public BoosterMapper(final BoostStatsService statsService) {
        this.statsService = statsService;
    }

    @Override
    public BoosterDto toDto(final BoosterProfile p) {
        return new BoosterDto(p.getId(), p.getNickname(), p.getLevel(),
                BoosterLevel.from(p.getLevel()).label(), p.getKeycloakUserId(), p.getAvailable(),
                p.getStatus(), BoosterStatus.from(p.getStatus()).label(),
                p.getContactType(), p.getContactValue(), p.getSpecialties(),
                p.getDescription(), (int) statsService.activeAssignmentCount(p.getId()),
                p.getCreatedAt(), p.getUpdatedAt());
    }
}

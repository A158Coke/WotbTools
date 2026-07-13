package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.BoosterDto;
import com.wotb.web.boost.entity.BoosterProfile;
import com.wotb.web.util.Mapper;
import org.springframework.stereotype.Service;

@Service
public class BoosterMapper implements Mapper<BoosterProfile, BoosterDto> {

    private final BoostStatsService statsService;

    public BoosterMapper(final BoostStatsService statsService) {
        this.statsService = statsService;
    }

    @Override
    public BoosterDto toDto(final BoosterProfile booster) {
        return new BoosterDto(booster.getId(), booster.getNickname(), booster.getLevel(),
                booster.getKeycloakUserId(), booster.getAvailable(), booster.getStatus(),
                booster.getContactType(), booster.getContactValue(), booster.getSpecialties(),
                booster.getDescription(), (int) statsService.activeAssignmentCount(booster.getId()),
                booster.getCreatedAt(), booster.getUpdatedAt());
    }
}

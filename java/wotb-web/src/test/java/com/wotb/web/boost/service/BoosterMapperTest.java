package com.wotb.web.boost.service;

import com.wotb.web.boost.dto.BoosterDto;
import com.wotb.web.boost.entity.BoosterProfile;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class BoosterMapperTest {

    @Test
    void shouldExposeBoosterServer() {
        final BoostStatsService statsService = mock(BoostStatsService.class);
        final BoosterProfile booster = new BoosterProfile();
        booster.setId(7L);
        booster.setNickname("EU Booster");
        booster.setLevel("MASTER");
        booster.setKeycloakUserId("kc-eu");
        booster.setWotbServer("EU");
        booster.setAvailable(true);
        booster.setStatus("ACTIVE");
        when(statsService.activeAssignmentCount(7L)).thenReturn(0L);

        final BoosterDto dto = new BoosterMapper(statsService).toDto(booster);

        assertThat(dto.wotbServer()).isEqualTo("EU");
        assertThat(dto.level()).isEqualTo("MASTER");
    }
}

package com.wotb.web;

import com.wotb.web.boost.controller.MyBoosterController;
import com.wotb.web.boost.dto.BoosterDto;
import com.wotb.web.boost.service.BoosterService;
import com.wotb.web.util.JwtUtil;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Optional;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class MyBoosterControllerTest {

    @Test
    void myAvailabilityShouldToggleCurrentBooster() throws Exception {
        final BoosterService boosterService = mock(BoosterService.class);
        final BoosterDto booster = new BoosterDto(
                7L, "booster", "ELITE", "elite", "kc-booster",
                true, "ACTIVE", "active", null, null, null, null,
                0, null, null
        );
        final BoosterDto updated = new BoosterDto(
                7L, "booster", "ELITE", "elite", "kc-booster",
                false, "ACTIVE", "active", null, null, null, null,
                0, null, null
        );
        when(boosterService.findByKeycloakUserId("kc-booster")).thenReturn(Optional.of(booster));
        when(boosterService.setAvailability(7L, false)).thenReturn(updated);

        final MockMvc mvc = MockMvcBuilders
                .standaloneSetup(new MyBoosterController(boosterService))
                .build();

        try (MockedStatic<JwtUtil> jwt = mockStatic(JwtUtil.class)) {
            jwt.when(JwtUtil::requireUserId).thenReturn("kc-booster");

            mvc.perform(patch("/api/boost/boosters/my/availability")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"available\":false}"))
                    .andExpect(status().isOk());
        }

        verify(boosterService).setAvailability(eq(7L), eq(false));
    }
}

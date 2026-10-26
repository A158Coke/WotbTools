package com.wotb.web.hof.controller;

import com.wotb.web.hof.dto.HallOfFameRecordDto;
import com.wotb.web.hof.service.HallOfFameService;
import com.wotb.web.user.api.UserProfiles;
import com.wotb.web.user.api.UserProfileSnapshot;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.Optional;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class MyHallOfFameRecordsControllerTest {

    private final UserProfiles profiles = mock(UserProfiles.class);
    private final HallOfFameService records = mock(HallOfFameService.class);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.standaloneSetup(new MyHallOfFameRecordsController(profiles, records)).build();
        final Jwt jwt = Jwt.withTokenValue("test-token").header("alg", "none").subject("kc-user").build();
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(jwt, null));
    }

    @AfterEach
    void clearAuthentication() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void missingProfileKeepsAnEmptyResponse() throws Exception {
        when(profiles.findSnapshotByKeycloakUserId("kc-user")).thenReturn(Optional.empty());

        mvc.perform(get("/api/users/profile/records")).andExpect(status().isOk()).andExpect(content().json("[]"));
        verifyNoInteractions(records);
    }

    @Test
    void unboundProfileKeepsAnEmptyResponse() throws Exception {
        when(profiles.findSnapshotByKeycloakUserId("kc-user")).thenReturn(Optional.of(snapshot(null)));

        mvc.perform(get("/api/users/profile/records")).andExpect(status().isOk()).andExpect(content().json("[]"));
        verifyNoInteractions(records);
    }

    @Test
    void boundProfileKeepsTheAccountQueryLimitAndRecordResponse() throws Exception {
        when(profiles.findSnapshotByKeycloakUserId("kc-user")).thenReturn(Optional.of(snapshot(123L)));
        when(records.recordsByAccountId(123L, 50)).thenReturn(List.of(new HallOfFameRecordDto(
                7L, null, 385L, "Progetto 65", "PlayerOne", 3200, "RANDOM", "milbase", "11.18.0",
                null, null, true)));

        mvc.perform(get("/api/users/profile/records")).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(7))
                .andExpect(jsonPath("$[0].tankId").value(385))
                .andExpect(jsonPath("$[0].replayAvailable").value(true))
                .andExpect(jsonPath("$[0].keycloakUserId").doesNotExist());
        verify(records).recordsByAccountId(123L, 50);
    }

    private static UserProfileSnapshot snapshot(final Long accountId) {
        return new UserProfileSnapshot(1L, "kc-user", "PlayerOne", accountId, "PlayerOne", "CN", null, null);
    }
}

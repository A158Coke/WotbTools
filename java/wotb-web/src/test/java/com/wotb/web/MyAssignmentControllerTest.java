package com.wotb.web;

import com.wotb.web.boost.controller.MyAssignmentController;
import com.wotb.web.boost.dto.BoosterDto;
import com.wotb.web.boost.service.BoostAssignmentService;
import com.wotb.web.boost.service.BoosterService;
import com.wotb.web.util.JwtUtil;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class MyAssignmentControllerTest {

    @Test
    void assignmentsShouldBindIncludeHistoryQueryParam() throws Exception {
        final BoostAssignmentService assignmentService = mock(BoostAssignmentService.class);
        final BoosterService boosterService = mock(BoosterService.class);
        final BoosterDto booster = new BoosterDto(
                7L, "booster", "ELITE", "kc-booster",
                true, "ACTIVE", null, null, null, null,
                0, null, null
        );
        when(boosterService.findByKeycloakUserId("kc-booster")).thenReturn(Optional.of(booster));
        when(assignmentService.findByBooster(7L, true)).thenReturn(List.of());

        final MockMvc mvc = MockMvcBuilders
                .standaloneSetup(new MyAssignmentController(assignmentService, boosterService))
                .build();

        try (MockedStatic<JwtUtil> jwt = mockStatic(JwtUtil.class)) {
            jwt.when(JwtUtil::requireUserId).thenReturn("kc-booster");

            mvc.perform(get("/api/booster/assignments").param("includeHistory", "true"))
                    .andExpect(status().isOk());
        }

        verify(assignmentService).findByBooster(eq(7L), eq(true));
    }
}

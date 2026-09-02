package com.wotb.web.hundred.controller;

import com.wotb.web.hundred.dto.HundredLeaderboardPageDto;
import com.wotb.web.hundred.service.HundredBattleSubmissionService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 百场公开排行榜 HTTP 参数绑定契约（standalone MockMvc，无数据库）。 */
class HundredBattleControllerTest {

    private static final HundredLeaderboardPageDto EMPTY =
            new HundredLeaderboardPageDto(null, null, List.of(), 1, 10, 0, 0);

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void leaderboardBindsCategoryAndVehicleIntersectionParams() throws Exception {
        final HundredBattleSubmissionService service = mock(HundredBattleSubmissionService.class);
        when(service.leaderboard(any(), any(), any(), anyInt(), anyInt())).thenReturn(EMPTY);
        final MockMvc mvc = MockMvcBuilders.standaloneSetup(new HundredBattleController(service)).build();

        mvc.perform(get("/api/hof/hundred")
                        .param("nation", "FRANCE")
                        .param("vehicleType", "LIGHT_TANK")
                        .param("vehicleId", "3649")
                        .param("page", "2")
                        .param("size", "20"))
                .andExpect(status().isOk());

        verify(service).leaderboard(3649L, "FRANCE", "LIGHT_TANK", 2, 20);
    }

    @Test
    void leaderboardDefaultsToUnfilteredGlobalContext() throws Exception {
        final HundredBattleSubmissionService service = mock(HundredBattleSubmissionService.class);
        when(service.leaderboard(any(), any(), any(), anyInt(), anyInt())).thenReturn(EMPTY);
        final MockMvc mvc = MockMvcBuilders.standaloneSetup(new HundredBattleController(service)).build();

        mvc.perform(get("/api/hof/hundred")).andExpect(status().isOk());

        verify(service).leaderboard(null, null, null, 1, 50);
    }

}

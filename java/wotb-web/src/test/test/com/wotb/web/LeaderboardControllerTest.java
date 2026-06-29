package com.wotb.web;

import com.wotb.web.controller.LeaderboardController;
import com.wotb.web.dto.LeaderboardRecordDto;
import com.wotb.web.service.LeaderboardService;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.OffsetDateTime;
import java.util.List;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Controller HTTP 绑定测试 (standalone MockMvc + mock service, 无需 DB / postgres profile)。
 * 守住 @RequestParam/@PathVariable 参数名绑定 —— 这正是 -parameters 缺失会在运行时炸的地方。
 */
class LeaderboardControllerTest {

    private static LeaderboardRecordDto dto() {
        return new LeaderboardRecordDto(1L, "arenaA", 6481L, "FV4005",
                111L, "Recorder1", 3200, "milbase",
                "11.18.0", OffsetDateTime.now(), OffsetDateTime.now());
    }

    private MockMvc mvc(final LeaderboardService svc) {
        return MockMvcBuilders.standaloneSetup(new LeaderboardController(svc)).build();
    }

    @Test
    void topDamageDefaultAndExplicitLimit() throws Exception {
        final LeaderboardService svc = mock(LeaderboardService.class);
        when(svc.topDamage(anyInt())).thenReturn(List.of(dto()));
        final MockMvc mvc = mvc(svc);
        mvc.perform(get("/api/leaderboard/top-damage")).andExpect(status().isOk());
        mvc.perform(get("/api/leaderboard/top-damage").param("limit", "10")).andExpect(status().isOk());
    }

    @Test
    void topDamageByTankBindsPathAndParam() throws Exception {
        final LeaderboardService svc = mock(LeaderboardService.class);
        when(svc.topDamageByTank(eq(6481L), anyInt())).thenReturn(List.of(dto()));
        mvc(svc).perform(get("/api/leaderboard/tanks/6481/top-damage").param("limit", "25"))
                .andExpect(status().isOk());
    }
}

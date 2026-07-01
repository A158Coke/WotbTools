package test.test.com.wotb.web;

import com.wotb.web.leaderboard.controller.LeaderboardController;
import com.wotb.web.leaderboard.dto.LeaderboardPageDto;
import com.wotb.web.leaderboard.dto.LeaderboardRecordDto;
import com.wotb.web.leaderboard.service.LeaderboardService;
import org.assertj.core.api.Assertions;
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

    private static final LeaderboardPageDto PAGE = new LeaderboardPageDto(List.of(), 1, 50, 0, 0);

    private static LeaderboardRecordDto dto() {
        return new LeaderboardRecordDto(1L, "arenaA", 6481L, "FV4005",
                111L, "Recorder1", 3200, "milbase",
                "11.18.0", OffsetDateTime.now(), OffsetDateTime.now());
    }

    private static LeaderboardPageDto pageOf(final LeaderboardRecordDto item) {
        return new LeaderboardPageDto(List.of(item), 1, 50, 1, 1);
    }

    private MockMvc mvc(final LeaderboardService svc) {
        return MockMvcBuilders.standaloneSetup(new LeaderboardController(svc)).build();
    }

    @Test
    void topDamageDefaultAndExplicitPage() throws Exception {
        final LeaderboardService svc = mock(LeaderboardService.class);
        when(svc.topDamage(anyInt(), anyInt())).thenReturn(PAGE);
        final MockMvc mvc = mvc(svc);
        mvc.perform(get("/api/leaderboard/top-damage")).andExpect(status().isOk());
        mvc.perform(get("/api/leaderboard/top-damage").param("page", "2").param("size", "20"))
                .andExpect(status().isOk());
    }

    @Test
    void topDamageByTankBindsPathAndParam() throws Exception {
        final LeaderboardService svc = mock(LeaderboardService.class);
        when(svc.topDamageByTank(eq(6481L), anyInt(), anyInt())).thenReturn(PAGE);
        mvc(svc).perform(get("/api/leaderboard/tanks/6481/top-damage").param("size", "25"))
                .andExpect(status().isOk());
    }

    @Test
    void topDamageReturnsDtoList() throws Exception {
        final LeaderboardService svc = mock(LeaderboardService.class);
        when(svc.topDamage(anyInt(), anyInt())).thenReturn(pageOf(dto()));
        final String json = mvc(svc).perform(get("/api/leaderboard/top-damage"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        // 验证返回的是 page DTO 而非 flat list
        Assertions.assertThat(json).contains("\"items\"");
        Assertions.assertThat(json).contains("\"totalItems\"");
        Assertions.assertThat(json).contains("\"FV4005\"");
    }
}

package com.wotb.web.hundred.controller;

import com.wotb.web.hundred.dto.HundredAdminPageDto;
import com.wotb.web.hundred.service.HundredBattleSubmissionService;
import com.wotb.web.hundred.service.HundredReplayEvidenceService;
import org.junit.jupiter.api.Test;
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

/** 百场管理列表 HTTP 参数绑定契约（安全边界由 SecurityConfigTest 覆盖）。 */
class HundredBattleAdminControllerTest {

    @Test
    void listBindsStatusCategoryAndVehicleIntersectionParams() throws Exception {
        final HundredBattleSubmissionService service = mock(HundredBattleSubmissionService.class);
        when(service.adminList(any(), any(), any(), any(), anyInt(), anyInt()))
                .thenReturn(new HundredAdminPageDto(List.of(), 1, 50, 0, 0));
        final MockMvc mvc = MockMvcBuilders.standaloneSetup(new HundredBattleAdminController(
                service, mock(HundredReplayEvidenceService.class))).build();

        mvc.perform(get("/api/admin/hof/hundred/submissions")
                        .param("status", "CURRENT")
                        .param("nation", "EUROPE")
                        .param("vehicleType", "MEDIUM_TANK")
                        .param("vehicleId", "385")
                        .param("page", "2")
                        .param("size", "20"))
                .andExpect(status().isOk());

        verify(service).adminList("CURRENT", "EUROPE", "MEDIUM_TANK", 385L, 2, 20);
    }
}

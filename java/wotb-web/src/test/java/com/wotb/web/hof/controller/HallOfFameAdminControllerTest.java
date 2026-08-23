package com.wotb.web.hof.controller;

import com.wotb.web.hof.dto.HofAdminPageDto;
import com.wotb.web.hof.service.HallOfFameAdminService;
import com.wotb.web.hof.service.HallOfFameService;
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

/** 单场名人堂管理列表 HTTP 参数绑定契约（安全边界由 SecurityConfigTest 覆盖）。 */
class HallOfFameAdminControllerTest {

    @Test
    void listBindsIndependentVehicleCategoryFilters() throws Exception {
        final HallOfFameAdminService adminService = mock(HallOfFameAdminService.class);
        when(adminService.search(any(), any(), any(), any(), any(), any(), any(), any(),
                any(), any(), anyInt(), anyInt()))
                .thenReturn(new HofAdminPageDto(List.of(), 1, 50, 0, 0));
        final MockMvc mvc = MockMvcBuilders.standaloneSetup(new HallOfFameAdminController(
                adminService, mock(HallOfFameService.class))).build();

        mvc.perform(get("/api/admin/hof")
                        .param("nation", "EUROPE")
                        .param("vehicleType", "MEDIUM_TANK")
                        .param("tier", "10")
                        .param("tankId", "385")
                        .param("page", "2")
                        .param("size", "20"))
                .andExpect(status().isOk());

        verify(adminService).search(null, null, null, null, 385L,
                "EUROPE", "MEDIUM_TANK", 10, null, null, 2, 20);
    }
}

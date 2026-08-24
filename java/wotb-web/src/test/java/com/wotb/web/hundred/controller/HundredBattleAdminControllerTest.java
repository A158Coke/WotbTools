package com.wotb.web.hundred.controller;

import com.wotb.web.hundred.dto.HundredAdminPageDto;
import com.wotb.web.hundred.service.HundredBattleSubmissionService;
import com.wotb.web.hundred.service.HundredReplayEvidenceService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 百场管理 HTTP 参数绑定与审批契约（安全边界由 SecurityConfigTest 覆盖）。 */
class HundredBattleAdminControllerTest {

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

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

    @Test
    void approveIgnoresClientSuppliedScores() throws Exception {
        final HundredBattleSubmissionService service = mock(HundredBattleSubmissionService.class);
        final Jwt jwt = Jwt.withTokenValue("t").header("alg", "none").subject("kc-user").build();
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(jwt, null));
        final MockMvc mvc = MockMvcBuilders.standaloneSetup(new HundredBattleAdminController(
                service, mock(HundredReplayEvidenceService.class))).build();

        mvc.perform(post("/api/admin/hof/hundred/submissions/10/approve")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"approvedAverageDamage\":9999,\"approvedBattleCount\":1}"))
                .andExpect(status().isOk());

        verify(service).approve("kc-user", 10L);
    }
}

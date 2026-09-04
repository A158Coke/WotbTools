package com.wotb.web.mark3.controller;

import com.wotb.web.mark3.dto.Mark3CreateResult;
import com.wotb.web.mark3.dto.Mark3LeaderboardPageDto;
import com.wotb.web.mark3.service.Mark3SubmissionService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.math.BigDecimal;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 三环 HTTP 参数绑定：字段名与前端 FormData 契约必须保持一致。 */
class Mark3ControllerTest {

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void leaderboardBindsSharedVehicleFilters() throws Exception {
        final Mark3SubmissionService service = mock(Mark3SubmissionService.class);
        when(service.leaderboard(any(), any(), any(), anyInt(), anyInt()))
                .thenReturn(new Mark3LeaderboardPageDto(null, null, List.of(), 1, 10, 0, 0));
        final MockMvc mvc = MockMvcBuilders.standaloneSetup(new Mark3Controller(service)).build();

        mvc.perform(get("/api/hof/mark3")
                        .param("vehicleId", "385")
                        .param("nation", "EUROPE")
                        .param("vehicleType", "MEDIUM_TANK")
                        .param("page", "2")
                        .param("size", "20"))
                .andExpect(status().isOk());

        verify(service).leaderboard(385L, "EUROPE", "MEDIUM_TANK", 2, 20);
    }

    @Test
    void multipartCreatePreservesCommaInSingleScreenshotDataUrl() throws Exception {
        final Mark3SubmissionService service = mock(Mark3SubmissionService.class);
        when(service.createSubmission(
                eq("kc-user"), eq(385L), eq(36), eq(4_203), eq(new BigDecimal("78")),
                eq(List.of("data:image/jpeg;base64,AAAA")), anyList()))
                .thenReturn(new Mark3CreateResult(6L, "PENDING"));
        final Jwt jwt = Jwt.withTokenValue("t").header("alg", "none").subject("kc-user").build();
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(jwt, null));
        final MockMvc mvc = MockMvcBuilders.standaloneSetup(new Mark3Controller(service)).build();

        final var request = multipart("/api/hof/mark3/submissions")
                .file(replay("a"))
                .file(replay("b"))
                .file(replay("c"))
                .file(replay("d"))
                .file(replay("e"))
                .param("vehicleId", "385")
                .param("battleCount", "36")
                .param("averageDamage", "4203")
                .param("winRate", "78")
                .param("proofScreenshots", "data:image/jpeg;base64,AAAA");
        mvc.perform(request)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(6))
                .andExpect(jsonPath("$.status").value("PENDING"));

        verify(service).createSubmission(
                eq("kc-user"), eq(385L), eq(36), eq(4_203), eq(new BigDecimal("78")),
                eq(List.of("data:image/jpeg;base64,AAAA")), anyList());
    }

    @Test
    void multipartCreateBindsTwoScreenshotsAndFiveReplays() throws Exception {
        final Mark3SubmissionService service = mock(Mark3SubmissionService.class);
        when(service.createSubmission(
                eq("kc-user"), eq(385L), eq(123), eq(3_456), eq(new BigDecimal("55.25")),
                eq(List.of("data:image/png;base64,AAAA", "data:image/jpeg;base64,BBBB")), anyList()))
                .thenReturn(new Mark3CreateResult(7L, "PENDING"));
        final Jwt jwt = Jwt.withTokenValue("t").header("alg", "none").subject("kc-user").build();
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(jwt, null));
        final MockMvc mvc = MockMvcBuilders.standaloneSetup(new Mark3Controller(service)).build();

        final var request = multipart("/api/hof/mark3/submissions")
                .file(replay("a"))
                .file(replay("b"))
                .file(replay("c"))
                .file(replay("d"))
                .file(replay("e"))
                .param("vehicleId", "385")
                .param("battleCount", "123")
                .param("averageDamage", "3456")
                .param("winRate", "55.25")
                .param("proofScreenshots", "data:image/png;base64,AAAA")
                .param("proofScreenshots", "data:image/jpeg;base64,BBBB");
        mvc.perform(request)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(7))
                .andExpect(jsonPath("$.status").value("PENDING"));

        verify(service).createSubmission(
                eq("kc-user"), eq(385L), eq(123), eq(3_456), eq(new BigDecimal("55.25")),
                eq(List.of("data:image/png;base64,AAAA", "data:image/jpeg;base64,BBBB")), anyList());
    }

    private static MockMultipartFile replay(final String content) {
        return new MockMultipartFile(
                "replays", content + ".wotbreplay", "application/octet-stream", content.getBytes());
    }
}

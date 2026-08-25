package com.wotb.web.mark3.controller;

import com.wotb.web.mark3.service.Mark3ReplayEvidenceService;
import com.wotb.web.mark3.service.Mark3SubmissionService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** approve endpoint must never bind client-supplied score fields. */
class Mark3AdminControllerTest {

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void approveIgnoresClientSuppliedScores() throws Exception {
        final Mark3SubmissionService service = mock(Mark3SubmissionService.class);
        final Jwt jwt = Jwt.withTokenValue("t").header("alg", "none").subject("kc-admin").build();
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(jwt, null));
        final MockMvc mvc = MockMvcBuilders.standaloneSetup(
                new Mark3AdminController(service, mock(Mark3ReplayEvidenceService.class))).build();

        mvc.perform(post("/api/admin/hof/mark3/submissions/10/approve")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"approvedBattleCount\":1,\"approvedAverageDamage\":9999,\"approvedWinRate\":100}"))
                .andExpect(status().isOk());

        verify(service).approve("kc-admin", 10L);
    }
}

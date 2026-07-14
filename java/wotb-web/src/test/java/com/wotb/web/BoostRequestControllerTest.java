package com.wotb.web;

import com.wotb.web.boost.controller.BoostRequestController;
import com.wotb.web.boost.dto.ConfirmBoostRequestResponse;
import com.wotb.web.boost.service.BoostAssignmentService;
import com.wotb.web.boost.service.BoostRequestService;
import com.wotb.web.util.JwtUtil;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.OffsetDateTime;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class BoostRequestControllerTest {

    @Test
    void requesterShouldConfirmCompletionThroughDedicatedEndpoint() throws Exception {
        final BoostRequestService requestService = mock(BoostRequestService.class);
        final BoostAssignmentService assignmentService = mock(BoostAssignmentService.class);
        final OffsetDateTime completedAt = OffsetDateTime.parse("2026-07-14T12:00:00Z");
        when(assignmentService.confirmByRequester(5L, "kc-requester"))
                .thenReturn(new ConfirmBoostRequestResponse(
                        5L, "CLOSED", "BOOST_REQUEST_COMPLETED", completedAt
                ));
        final MockMvc mvc = MockMvcBuilders
                .standaloneSetup(new BoostRequestController(requestService, assignmentService))
                .build();

        try (MockedStatic<JwtUtil> jwt = mockStatic(JwtUtil.class)) {
            jwt.when(JwtUtil::requireUserId).thenReturn("kc-requester");

            mvc.perform(patch("/api/boost/requests/my/5/confirm-completion"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status").value("CLOSED"))
                    .andExpect(jsonPath("$.code").value("BOOST_REQUEST_COMPLETED"));
        }

        verify(assignmentService).confirmByRequester(5L, "kc-requester");
    }
}

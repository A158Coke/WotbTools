package com.wotb.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wotb.web.admin.dto.AdminDeleteUserResponse;
import com.wotb.web.boost.dto.BoostAssignmentDto;
import com.wotb.web.boost.dto.BoosterDto;
import com.wotb.web.boost.dto.CreateBoostRequestResponse;
import com.wotb.web.boost.dto.CreateBoosterApplicationResponse;
import com.wotb.web.boost.dto.ConfirmBoostRequestResponse;
import com.wotb.web.boost.service.BoostOptionsMapper;
import com.wotb.web.boost.service.BoostOptionsService;
import com.wotb.web.controller.GlobalExceptionHandler;
import com.wotb.web.replay.exception.ReplayBusyException;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.time.OffsetDateTime;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ApiContractTest {

    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

    @Test
    void boostDtosShouldExposeRawKeysWithoutLocalizedLabels() throws Exception {
        final BoosterDto booster = new BoosterDto(
                7L, "booster", "ELITE", "kc-user", true, "ACTIVE",
                "QQ", "123", null, null, 0, null, null
        );
        final BoostAssignmentDto assignment = new BoostAssignmentDto(
                9L, 10L, null, "ASSIGNED", "COACHING", "target",
                "MATCHED", "QQ", "123", null, null, null,
                null, null, null, null, null, null, null
        );

        final String json = objectMapper.writeValueAsString(Map.of(
                "booster", booster,
                "assignment", assignment,
                "options", new BoostOptionsService(new BoostOptionsMapper()).options()
        ));

        assertThat(json)
                .contains("\"level\":\"ELITE\"")
                .contains("\"requestType\":\"COACHING\"")
                .contains("\"warningCode\":\"SENSITIVE_INFO_WARNING\"")
                .doesNotContain("Label\"")
                .doesNotContain("\"label\"")
                .doesNotContain("\"warning\"")
                .doesNotContain("\"message\"");
    }

    @Test
    void successfulMutationResponsesShouldUseCode() throws Exception {
        final OffsetDateTime now = OffsetDateTime.parse("2026-07-12T00:00:00Z");
        final String json = objectMapper.writeValueAsString(Map.of(
                "request", new CreateBoostRequestResponse(
                        1L, "NEW", "BOOST_REQUEST_SUBMITTED", now
                ),
                "confirmation", new ConfirmBoostRequestResponse(
                        1L, "CLOSED", "BOOST_REQUEST_COMPLETED", now
                ),
                "application", new CreateBoosterApplicationResponse(
                        2L, "NEW", "BOOSTER_APPLICATION_SUBMITTED", now
                )
        ));

        assertThat(json)
                .contains("\"code\":\"BOOST_REQUEST_SUBMITTED\"")
                .contains("\"code\":\"BOOST_REQUEST_COMPLETED\"")
                .contains("\"code\":\"BOOSTER_APPLICATION_SUBMITTED\"")
                .doesNotContain("\"message\"");
    }

    @Test
    void errorsShouldExposeOnlyStableCodeAndTimestamp() {
        final GlobalExceptionHandler handler = new GlobalExceptionHandler();
        final ResponseEntity<Map<String, Object>> response = handler.handleIllegalArgument(
                new IllegalArgumentException("中文异常不应进入 API")
        );

        assertThat(response.getBody())
                .containsEntry("error", "INVALID_ARGUMENT")
                .containsKey("timestamp")
                .doesNotContainKey("message");
    }

    @Test
    void replayCapacityErrorShouldReturnServiceUnavailable() {
        final GlobalExceptionHandler handler = new GlobalExceptionHandler();
        final ResponseEntity<Map<String, Object>> response = handler.handleReplayBusy(
                new ReplayBusyException()
        );

        assertThat(response.getStatusCode().value()).isEqualTo(503);
        assertThat(response.getBody())
                .containsEntry("error", "REPLAY_BUSY")
                .containsKey("timestamp")
                .doesNotContainKey("message");
    }

    @Test
    void adminDeleteResponseShouldNotExposeUnusedMessageFields() throws Exception {
        final String json = objectMapper.writeValueAsString(
                new AdminDeleteUserResponse(true, "kc-user", true, true)
        );

        assertThat(json)
                .doesNotContain("\"message\"")
                .doesNotContain("\"error\"");
    }
}

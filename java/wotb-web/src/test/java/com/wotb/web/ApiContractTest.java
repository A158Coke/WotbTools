package com.wotb.web;

import com.wotb.web.admin.dto.DeleteUserResult;
import com.wotb.web.admin.dto.DeleteUsersResponse;
import com.wotb.web.exceptionhandler.GlobalExceptionHandler;
import com.wotb.web.util.apierror.ApiErrorResponse;
import com.wotb.web.replay.exception.ReplayBusyException;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ApiContractTest {

    private final ObjectMapper objectMapper = JsonMapper.builder().findAndAddModules().build();

    @Test
    void errorsShouldExposeCanonicalSafeContract() {
        final GlobalExceptionHandler handler = new GlobalExceptionHandler();
        final ResponseEntity<ApiErrorResponse> response = handler.handleIllegalArgument(
                new IllegalArgumentException("中文异常不应进入 API")
        );

        assertThat(response.getBody().errorCode()).isEqualTo("INVALID_ARGUMENT");
        assertThat(response.getBody().status()).isEqualTo(400);
        assertThat(response.getBody().id()).isNotBlank();
        assertThat(response.getBody().details()).isEmpty();
        assertThat(response.getBody().timestamp()).isNotNull();
    }

    @Test
    void replayCapacityErrorShouldReturnServiceUnavailable() {
        final GlobalExceptionHandler handler = new GlobalExceptionHandler();
        final ResponseEntity<ApiErrorResponse> response = handler.handleReplayBusy(
                new ReplayBusyException()
        );

        assertThat(response.getStatusCode().value()).isEqualTo(503);
        assertThat(response.getBody().errorCode()).isEqualTo("REPLAY_BUSY");
        assertThat(response.getBody().retryable()).isTrue();
        assertThat(response.getBody().timestamp()).isNotNull();
    }

    @Test
    void adminDeleteResponseShouldNotExposeUnusedMessageFields() {
        final String json = objectMapper.writeValueAsString(
                new DeleteUsersResponse(1, 1, 0, List.of(new DeleteUserResult("kc-user", true, null)))
        );

        assertThat(json)
                .doesNotContain("\"message\"")
                .doesNotContain("\"error\"");
    }
}

package com.wotb.web;

import com.wotb.web.admin.dto.AdminDeleteUserResponse;
import com.wotb.web.boost.dto.BoostAssignmentDto;
import com.wotb.web.boost.dto.BoosterApplicationSummaryDto;
import com.wotb.web.boost.dto.BoosterDto;
import com.wotb.web.boost.dto.ConfirmBoostRequestResponse;
import com.wotb.web.boost.dto.CreateBoostRequestResponse;
import com.wotb.web.boost.dto.CreateBoosterApplicationResponse;
import com.wotb.web.boost.dto.OptionDto;
import com.wotb.web.boost.enums.BoosterLevel;
import com.wotb.web.boost.service.BoostOptionsMapper;
import com.wotb.web.boost.service.BoostOptionsService;
import com.wotb.web.exceptionhandler.GlobalExceptionHandler;
import com.wotb.web.util.apierror.ApiErrorResponse;
import com.wotb.web.replay.exception.ReplayBusyException;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.time.OffsetDateTime;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ApiContractTest {

    private final ObjectMapper objectMapper = JsonMapper.builder().findAndAddModules().build();

    @Test
    void boostDtosShouldExposeRawKeysWithoutLocalizedLabels() throws Exception {
        final var options = new BoostOptionsService(new BoostOptionsMapper()).options();
        final BoosterDto booster = new BoosterDto(
                7L, "booster", "ELITE", "kc-user", "EU", true, "ACTIVE",
                "QQ", "123", null, null, 0, null, null
        );
        final BoostAssignmentDto assignment = new BoostAssignmentDto(
                9L, 10L, null, "ASSIGNED", "EU", "COACHING", "target",
                "MATCHED", "QQ", "123", null, null, null,
                null, null, null, null, null, null, null
        );

        final String json = objectMapper.writeValueAsString(Map.of(
                "booster", booster,
                "assignment", assignment,
                "options", options
        ));

        assertThat(options.regions())
                .extracting(OptionDto::value)
                .containsExactly("CN", "ASIA", "EU", "NA");
        assertThat(json)
                .contains("\"level\":\"ELITE\"")
                .contains("\"wotbServer\":\"EU\"")
                .contains("\"region\":\"EU\"")
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
    void boosterApplicationSummariesShouldExcludeImagesAndExtendedDetails() throws Exception {
        final BoosterApplicationSummaryDto summary = new BoosterApplicationSummaryDto(
                2L,
                1001L,
                "Player",
                "ELITE",
                "123456",
                "MONTH_20",
                "NEW",
                null,
                null,
                OffsetDateTime.parse("2026-07-15T00:00:00Z")
        );

        final String json = objectMapper.writeValueAsString(summary);

        assertThat(json)
                .contains("\"wotbNickname\":\"Player\"")
                .contains("\"requestedLevel\":\"ELITE\"")
                .contains("\"qq\":\"123456\"")
                .contains("\"availabilityTier\":\"MONTH_20\"")
                .doesNotContain("overallStatsImage")
                .doesNotContain("vehicleStatsImage")
                .doesNotContain("dailyTimeWindow")
                .doesNotContain("selfAssessment");
    }

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
    void boosterLevelsShouldExposeFiveApplicationChoicesAndOneAdminOnlyValue() {
        assertThat(BoosterLevel.values())
                .extracting(Enum::name)
                .containsExactly("CASUAL", "SKILLED", "ELITE", "PRO", "MASTER", "AVERAGE_GOD");
        assertThat(java.util.Arrays.stream(BoosterLevel.values())
                .filter(BoosterLevel::canBeSelectedOnCreate)
                .map(Enum::name))
                .containsExactly("CASUAL", "SKILLED", "ELITE", "PRO", "MASTER");
    }

    @Test
    void averageGodUniquenessShouldReturnConflict() {
        final GlobalExceptionHandler handler = new GlobalExceptionHandler();
        final ResponseEntity<ApiErrorResponse> response = handler.handleIllegalArgument(
                new IllegalArgumentException("AVERAGE_GOD_ALREADY_EXISTS")
        );

        assertThat(response.getStatusCode().value()).isEqualTo(409);
        assertThat(response.getBody().errorCode()).isEqualTo("AVERAGE_GOD_ALREADY_EXISTS");
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
                new AdminDeleteUserResponse("kc-user")
        );

        assertThat(json)
                .doesNotContain("\"message\"")
                .doesNotContain("\"error\"");
    }
}

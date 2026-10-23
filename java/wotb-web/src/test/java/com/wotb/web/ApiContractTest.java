package com.wotb.web;

import com.wotb.web.admin.dto.DeleteUserResult;
import com.wotb.web.admin.dto.DeleteUsersResponse;
import com.wotb.web.admin.dto.AdminUserPageDto;
import com.wotb.web.admin.service.AdminUserMapper;
import com.wotb.web.hof.dto.BulkDeleteItemResult;
import com.wotb.web.hof.dto.BulkDeleteResultDto;
import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.hundred.service.HundredBattleMapper;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.service.UserProfileMapper;
import com.wotb.web.exceptionhandler.GlobalExceptionHandler;
import com.wotb.web.util.apierror.ApiErrorResponse;
import com.wotb.web.replay.exception.ReplayBusyException;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import org.keycloak.representations.idm.UserRepresentation;

import static org.assertj.core.api.Assertions.assertThat;

class ApiContractTest {

    private final ObjectMapper objectMapper = JsonMapper.builder().findAndAddModules().build();

    /** 固定匿名样本同时由前端 api:fixture 对照 OpenAPI 校验，避免两侧各自维护假形状。 */
    @Test
    void businessBoundaryFixturesShouldMatchRealProducerSerialization() throws Exception {
        final UserProfile profile = new UserProfile();
        profile.setId(7L);
        profile.setKeycloakUserId("fixture-user");
        profile.setUsername("fixture-login");
        // 整分钟也必须保留秒，避免 OffsetDateTime.toString() 输出不符合 RFC 3339 的分钟精度。
        ReflectionTestUtils.setField(profile, "createdAt", OffsetDateTime.parse("2026-10-01T12:00:00Z"));
        final AdminUserMapper admin = new AdminUserMapper();
        final UserRepresentation keycloak = new UserRepresentation();
        keycloak.setId("fixture-user");
        keycloak.setUsername("fixture-login");
        keycloak.setEnabled(true);
        final HundredBattleSubmission submission = new HundredBattleSubmission();
        submission.setId(11L);
        submission.setVehicleId(42L);
        submission.setVehicleName("Fixture tank");
        submission.setWotbServer("CN");
        submission.setWotbAccountId(123L);
        submission.setNicknameSnapshot("Fixture player");
        submission.setClaimedAverageDamage(3000);
        submission.setClaimedBattleCount(100);
        submission.setStatus("PENDING");
        submission.setSubmittedAt(OffsetDateTime.parse("2026-10-01T12:00:00Z"));
        final HundredBattleMapper hundred = new HundredBattleMapper();
        final Object pending = hundred.toSummary(submission);
        submission.setStatus("DELETED");
        submission.setProofScreenshot("must-not-leak-in-terminal-state");
        submission.setDeletedAt(OffsetDateTime.parse("2026-10-02T12:00:00Z"));
        submission.setDeletedBy("fixture-admin");
        submission.setDeleteReason("OTHER");
        submission.setDeleteReasonText("Fixture cleanup");
        final List<WireCase> cases = List.of(
                new WireCase("UserProfile", new UserProfileMapper().toDto(profile)),
                new WireCase("AdminUserPage", new AdminUserPageDto(
                        List.of(admin.toListItem(keycloak, null), admin.toListItem(null, profile)), 0, 25, 2, 1)),
                new WireCase("AdminUserDetail", admin.toDetailDto("fixture-user", null,
                        admin.toKeycloakDto(keycloak, null), List.of())),
                new WireCase("AdminUserDetail", admin.toDetailDto("fixture-user", admin.toProfileDto(profile),
                        null, List.of("KEYCLOAK_USER_MISSING"))),
                new WireCase("DeleteUsersResponse", new DeleteUsersResponse(2, 1, 1, List.of(
                        new DeleteUserResult("fixture-user", true, null),
                        new DeleteUserResult("fixture-admin", false, "AUTH_FORBIDDEN")))),
                new WireCase("HundredSubmissionSummary", pending),
                new WireCase("HundredAdminDetail", hundred.toAdminDetail(submission)),
                new WireCase("BulkDeleteResult", new BulkDeleteResultDto(2, 1, 1, List.of(
                        new BulkDeleteItemResult(11L, true, null),
                        new BulkDeleteItemResult(12L, false, "HUNDRED_NOT_CURRENT")))));
        final Path fixture = Path.of("../../contracts/http/fixtures/business-boundaries.json");
        assertThat(objectMapper.readTree(objectMapper.writeValueAsString(cases)))
                .isEqualTo(objectMapper.readTree(Files.readString(fixture)));
    }

    private record WireCase(String schema, Object value) {}

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

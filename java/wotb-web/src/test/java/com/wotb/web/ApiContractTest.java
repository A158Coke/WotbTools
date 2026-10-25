package com.wotb.web;

import com.wotb.web.admin.dto.AdminUserPageDto;
import com.wotb.web.admin.dto.DeleteUserResult;
import com.wotb.web.admin.dto.DeleteUsersResponse;
import com.wotb.web.admin.service.AdminUserMapper;
import com.wotb.web.exceptionhandler.GlobalExceptionHandler;
import com.wotb.web.hof.dto.BulkDeleteItemResult;
import com.wotb.web.hof.dto.BulkDeleteResultDto;
import com.wotb.web.hof.dto.HofAdminAuditDto;
import com.wotb.web.hof.dto.HofAdminAuditPageDto;
import com.wotb.web.hof.dto.HofVehicleOptionDto;
import com.wotb.web.hof.entity.HallOfFameRecord;
import com.wotb.web.hof.service.HallOfFameRecordMapper;
import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.hundred.service.HundredBattleMapper;
import com.wotb.web.mark3.dto.Mark3AdminPageDto;
import com.wotb.web.mark3.dto.Mark3CreateResult;
import com.wotb.web.mark3.dto.Mark3UserStatusDto;
import com.wotb.web.mark3.entity.Mark3ReplayEvidence;
import com.wotb.web.mark3.entity.Mark3Submission;
import com.wotb.web.mark3.service.Mark3Mapper;
import com.wotb.web.replay.exception.ReplayBusyException;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.service.UserProfileMapper;
import com.wotb.web.user.service.UserProfileSnapshot;
import com.wotb.web.util.apierror.ApiErrorResponse;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.keycloak.representations.idm.UserRepresentation;
import org.springframework.data.domain.PageImpl;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

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
        final UserProfileSnapshot profileSnapshot = new UserProfileSnapshot(
                7L, "fixture-user", null, null, null, "CN",
                OffsetDateTime.parse("2026-10-01T12:00:00Z"), null);
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
        final List<WireCase> cases = new ArrayList<>(List.of(
                new WireCase("UserProfile", new UserProfileMapper().toDto(profile)),
                new WireCase("AdminUserPage", new AdminUserPageDto(
                        List.of(admin.toListItem(keycloak, null), admin.toListItem(null, profileSnapshot)), 0, 25, 2, 1)),
                new WireCase("AdminUserDetail", admin.toDetailDto("fixture-user", null,
                        admin.toKeycloakDto(keycloak, null), List.of())),
                new WireCase("AdminUserDetail", admin.toDetailDto("fixture-user", admin.toProfileDto(profileSnapshot),
                        null, List.of("KEYCLOAK_USER_MISSING"))),
                new WireCase("DeleteUsersResponse", new DeleteUsersResponse(2, 1, 1, List.of(
                        new DeleteUserResult("fixture-user", true, null),
                        new DeleteUserResult("fixture-admin", false, "AUTH_FORBIDDEN")))),
                new WireCase("HundredSubmissionSummary", pending),
                new WireCase("HundredAdminDetail", hundred.toAdminDetail(submission)),
                new WireCase("BulkDeleteResult", new BulkDeleteResultDto(2, 1, 1, List.of(
                        new BulkDeleteItemResult(11L, true, null),
                        new BulkDeleteItemResult(12L, false, "HUNDRED_NOT_CURRENT"))))));
        cases.addAll(hofAndMark3Cases());
        final Path fixture = Path.of("../../contracts/http/fixtures/business-boundaries.json");
        assertThat(objectMapper.readTree(objectMapper.writeValueAsString(cases)))
                .isEqualTo(objectMapper.readTree(Files.readString(fixture)));
    }

    @Test
    void bulkModerationDomainDtosKeepTheSharedOpenApiWireShape() throws Exception {
        final Path fixturePath = Path.of("../../contracts/http/fixtures/business-boundaries.json");
        final var fixtures = objectMapper.readTree(Files.readString(fixturePath));
        final var expectedResult = java.util.stream.StreamSupport.stream(fixtures.spliterator(), false)
                .filter(item -> "BulkDeleteResult".equals(item.get("schema").asString()))
                .map(item -> item.get("value")).findFirst().orElseThrow();
        final var hundredResult = new com.wotb.web.hundred.dto.BulkDeleteResultDto(2, 1, 1, List.of(
                new com.wotb.web.hundred.dto.BulkDeleteItemResult(11L, true, null),
                new com.wotb.web.hundred.dto.BulkDeleteItemResult(12L, false, "HUNDRED_NOT_CURRENT")));
        final var mark3Result = new com.wotb.web.mark3.dto.BulkDeleteResultDto(2, 1, 1, List.of(
                new com.wotb.web.mark3.dto.BulkDeleteItemResult(11L, true, null),
                new com.wotb.web.mark3.dto.BulkDeleteItemResult(12L, false, "MARK3_NOT_CURRENT")));
        final JsonNode hundredResultJson = objectMapper.valueToTree(hundredResult);
        final JsonNode mark3ResultJson = objectMapper.valueToTree(mark3Result);

        assertThat(hundredResultJson.properties().stream()
                .map(entry -> entry.getKey()).collect(Collectors.toSet()))
                .containsExactlyInAnyOrder("requested", "deleted", "failed", "results");
        assertThat(mark3ResultJson.properties().stream()
                .map(entry -> entry.getKey()).collect(Collectors.toSet()))
                .containsExactlyInAnyOrder("requested", "deleted", "failed", "results");
        assertThat(hundredResultJson.get("requested").asInt()).isEqualTo(expectedResult.get("requested").asInt());
        assertThat(hundredResultJson.get("deleted").asInt()).isEqualTo(expectedResult.get("deleted").asInt());
        assertThat(hundredResultJson.get("failed").asInt()).isEqualTo(expectedResult.get("failed").asInt());
        final JsonNode hundredRequestJson = objectMapper.valueToTree(
                new com.wotb.web.hundred.dto.BulkDeleteModerationRequest(
                        List.of(11L, 12L), "ADMIN_CORRECTION", "reviewed correction"));
        final JsonNode mark3RequestJson = objectMapper.valueToTree(
                new com.wotb.web.mark3.dto.BulkDeleteModerationRequest(
                        List.of(11L, 12L), "ADMIN_CORRECTION", "reviewed correction"));
        for (final JsonNode requestJson : List.of(hundredRequestJson, mark3RequestJson)) {
            assertThat(requestJson.properties().stream().map(entry -> entry.getKey()).collect(Collectors.toSet()))
                    .containsExactlyInAnyOrder("ids", "reason", "reasonText");
            assertThat(requestJson.get("ids").get(0).asLong()).isEqualTo(11L);
            assertThat(requestJson.get("ids").get(1).asLong()).isEqualTo(12L);
            assertThat(requestJson.get("reason").asString()).isEqualTo("ADMIN_CORRECTION");
            assertThat(requestJson.get("reasonText").asString()).isEqualTo("reviewed correction");
        }
    }

    private List<WireCase> hofAndMark3Cases() {
        final OffsetDateTime submittedAt = OffsetDateTime.parse("2026-10-01T12:00:00Z");
        final OffsetDateTime terminalAt = OffsetDateTime.parse("2026-10-02T12:00:00Z");
        final HallOfFameRecord record = new HallOfFameRecord();
        record.setId(21L);
        record.setAccountId(123L);
        record.setTankId(42L);
        record.setTankName("Fixture tank");
        record.setNickname("Fixture player");
        record.setDamageDealt(6000);
        record.setBattleType("RANDOM");
        record.setMapName("Fixture map");
        record.setVersion("11.0");
        record.setBattleTime(submittedAt);
        ReflectionTestUtils.setField(record, "createdAt", submittedAt);
        final HallOfFameRecordMapper hof = new HallOfFameRecordMapper();
        final Mark3Submission submission = new Mark3Submission();
        submission.setId(31L);
        submission.setVehicleId(42L);
        submission.setVehicleName("Fixture tank");
        submission.setWotbServer("CN");
        submission.setWotbAccountId(123L);
        submission.setNicknameSnapshot("Fixture player");
        submission.setClaimedBattleCount(36);
        submission.setClaimedAverageDamage(4000);
        submission.setClaimedWinRate(new BigDecimal("75"));
        submission.setSubmittedAt(submittedAt);
        submission.setStatus("PENDING");
        submission.setProofScreenshotFirst("data:image/png;base64,AAAA");
        final Mark3Mapper mark3 = new Mark3Mapper();
        final var pending = mark3.toSummary(submission);
        final var pendingDetail = mark3.toAdminDetail(submission);
        submission.setStatus("REJECTED");
        submission.setRejectedAt(terminalAt);
        submission.setRejectedBy("fixture-admin");
        submission.setRejectReason("OTHER");
        submission.setRejectReasonText("Fixture reason");
        final var rejected = mark3.toSummary(submission);
        submission.setRejectReason(null);
        submission.setRejectReasonText(null);
        submission.setRejectedAt(null);
        submission.setRejectedBy(null);
        submission.setStatus("CANCELLED");
        final var cancelled = mark3.toSummary(submission);
        submission.setStatus("CURRENT");
        submission.setApprovedBattleCount(36);
        submission.setApprovedAverageDamage(4000);
        submission.setApprovedWinRate(new BigDecimal("75"));
        submission.setApprovedAt(terminalAt);
        submission.setApprovedBy("fixture-admin");
        final var current = mark3.toSummary(submission);
        final var leaderboard = mark3.toTopLeaderboardPage(List.of(submission), 10, Map.of(36, 1));
        submission.setStatus("DELETED");
        submission.setDeletedAt(terminalAt);
        submission.setDeletedBy("fixture-admin");
        submission.setDeleteReason("OTHER");
        submission.setDeleteReasonText("Fixture cleanup");
        final Mark3ReplayEvidence evidence = new Mark3ReplayEvidence();
        evidence.setId(41L);
        evidence.setSlot(1);
        evidence.setOriginalFilename("fixture.wotbreplay");
        evidence.setFileSize(100L);
        evidence.setArenaId("fixture-arena");
        evidence.setSha256("a".repeat(64));
        evidence.setCreatedAt(submittedAt);
        return List.of(
                new WireCase("PersonalHallOfFameRecord", hof.toDto(record)),
                new WireCase("HofVehicleOption", new HofVehicleOptionDto(42L, "Fixture tank", "EUROPE", "MEDIUM_TANK", 10)),
                new WireCase("HofAdminPage", hof.toAdminPageDto(new PageImpl<>(List.of(record)), 1, 25)),
                new WireCase("HofAdminAuditPage", new HofAdminAuditPageDto(List.of(new HofAdminAuditDto(
                        22L, "DELETE_ENTRY", 21L, "fixture-arena", 123L, "Fixture player", 42L,
                        "Fixture tank", 6000, "RANDOM", 1, null, "fixture-admin", null, submittedAt)), 1, 25, 1, 1)),
                new WireCase("Mark3CreateResult", new Mark3CreateResult(31L, "PENDING")),
                new WireCase("Mark3SubmissionSummary", pending),
                new WireCase("Mark3SubmissionSummary", rejected),
                new WireCase("Mark3SubmissionSummary", cancelled),
                new WireCase("Mark3UserStatus", new Mark3UserStatusDto(List.of(current), List.of(pending), List.of(rejected))),
                new WireCase("Mark3LeaderboardPage", leaderboard),
                new WireCase("Mark3AdminPage", new Mark3AdminPageDto(List.of(mark3.toAdminListItem(submission)), 1, 25, 1, 1)),
                new WireCase("Mark3AdminDetail", pendingDetail),
                new WireCase("Mark3AdminDetail", mark3.toAdminDetail(submission)),
                new WireCase("Mark3ReplayEvidence", mark3.toReplayEvidenceDto(evidence)));
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
    void apiErrorSerializationMatchesOpenApiPropertyShape() throws Exception {
        final ApiErrorResponse error = new ApiErrorResponse("error-1", "INVALID_ARGUMENT", null,
                400, false, Map.of("field", "vehicleId"), Instant.parse("2026-10-25T10:15:30Z"));
        final var json = objectMapper.readTree(objectMapper.writeValueAsString(error));

        assertThat(json.properties().stream().map(Map.Entry::getKey).collect(Collectors.toSet()))
                .containsExactlyInAnyOrder("id", "errorCode", "errorMsg", "status", "retryable", "details", "timestamp");
        assertThat(json.get("id").asString()).isEqualTo("error-1");
        assertThat(json.get("errorCode").asString()).isEqualTo("INVALID_ARGUMENT");
        assertThat(json.get("errorMsg").isNull()).isTrue();
        assertThat(json.get("status").asInt()).isEqualTo(400);
        assertThat(json.get("retryable").asBoolean()).isFalse();
        assertThat(json.get("details").get("field").asString()).isEqualTo("vehicleId");
        assertThat(json.get("timestamp").asString()).isEqualTo("2026-10-25T10:15:30Z");
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

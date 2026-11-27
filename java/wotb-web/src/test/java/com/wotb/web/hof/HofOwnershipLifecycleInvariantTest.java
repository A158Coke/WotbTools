package com.wotb.web.hof;

import com.wotb.web.hof.entity.HallOfFameRecord;
import com.wotb.web.hof.repository.HallOfFameRecordRepository;
import com.wotb.web.hof.service.HallOfFameService;
import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.hundred.repository.HundredBattleSubmissionRepository;
import com.wotb.web.hundred.service.HundredBattleSubmissionService;
import com.wotb.web.mark3.entity.Mark3Submission;
import com.wotb.web.mark3.repository.Mark3SubmissionRepository;
import com.wotb.web.mark3.service.Mark3SubmissionService;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.repository.UserProfileRepository;
import com.wotb.web.user.api.UserProfiles;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
class HofOwnershipLifecycleInvariantTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("wotb").withUsername("wotb").withPassword("wotb");

    @DynamicPropertySource
    static void configure(final DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "validate");
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.security.oauth2.resourceserver.jwt.issuer-uri",
                () -> "http://test-issuer");
        registry.add("keycloak.admin.server-url", () -> "http://test-keycloak");
        registry.add("keycloak.admin.realm", () -> "test");
        registry.add("keycloak.admin.client-id", () -> "test");
        registry.add("keycloak.admin.client-secret", () -> "test");
        registry.add("wotb.hof.replay-dir", () -> "data/replays-it");
    }

    private static final long WOTB_ACCOUNT_ID = 100L;
    private static final String CN = "CN";

    @Autowired
    UserProfileRepository userProfileRepository;

    @Autowired
    UserProfiles userProfileService;

    @Autowired
    HallOfFameRecordRepository recordRepository;

    @Autowired
    HundredBattleSubmissionRepository hundredRepository;

    @Autowired
    Mark3SubmissionRepository mark3Repository;

    @Autowired
    HundredBattleSubmissionService hundredService;

    @Autowired
    Mark3SubmissionService mark3Service;

    @Autowired
    HallOfFameService hallOfFameService;

    @BeforeEach
    void clean() {
        recordRepository.deleteAll();
        hundredRepository.deleteAll();
        mark3Repository.deleteAll();
        userProfileRepository.deleteAll();
        recordRepository.flush();
    }

    @Test
    void deletingTheKeycloakUserKeepsHofRowsAndLetsANewUserRebindTheSameWotbAccount() {
        userProfileRepository.saveAndFlush(profile("kc-user-a", CN, WOTB_ACCOUNT_ID));
        recordRepository.saveAndFlush(singleRecord());
        hundredRepository.saveAndFlush(hundredSubmission(CN, WOTB_ACCOUNT_ID));
        mark3Repository.saveAndFlush(mark3Submission(CN, WOTB_ACCOUNT_ID));

        userProfileService.deleteForAdministration("kc-user-a");

        assertEquals(1, recordRepository.count(), "删除 Keycloak 用户不得删除单场记录");
        assertEquals(1, hundredRepository.count(), "删除 Keycloak 用户不得删除百场 submission");
        assertEquals(1, mark3Repository.count(), "删除 Keycloak 用户不得删除三环 submission");

        userProfileRepository.saveAndFlush(profile("kc-user-b", CN, WOTB_ACCOUNT_ID));
        assertEquals(WOTB_ACCOUNT_ID,
                userProfileRepository.findByKeycloakUserId("kc-user-b").orElseThrow().getWotbAccountId());

        assertThrows(DataIntegrityViolationException.class,
                () -> userProfileRepository.saveAndFlush(profile("kc-user-c", CN, WOTB_ACCOUNT_ID)));
        userProfileRepository.saveAndFlush(profile("kc-user-asia", "ASIA", WOTB_ACCOUNT_ID));

        assertEquals(1, hallOfFameService.recordsByAccountId(WOTB_ACCOUNT_ID, 50).size(),
                "新用户绑定同一 WotB 账号后应重新看到单场记录");
        assertEquals(1, hundredService.userStatus("kc-user-b").current().size(),
                "新用户绑定同一 WotB 账号后应重新看到百场 CURRENT");
        assertEquals(1, mark3Service.userStatus("kc-user-b").current().size(),
                "新用户绑定同一 WotB 账号后应重新看到三环 CURRENT");

        userProfileRepository.saveAndFlush(profile("kc-user-d", CN, null));
        assertTrue(hundredService.userStatus("kc-user-d").current().isEmpty());
        assertTrue(mark3Service.userStatus("kc-user-d").current().isEmpty());
    }

    @Test
    void crossRegionAccountsSharingTheSameNumericIdNeverSeeEachOther() {
        userProfileRepository.saveAndFlush(profile("kc-cn", CN, WOTB_ACCOUNT_ID));
        userProfileRepository.saveAndFlush(profile("kc-asia", "ASIA", WOTB_ACCOUNT_ID));
        hundredRepository.saveAndFlush(hundredSubmission(CN, WOTB_ACCOUNT_ID));
        mark3Repository.saveAndFlush(mark3Submission("ASIA", WOTB_ACCOUNT_ID));

        assertEquals(1, hundredService.userStatus("kc-cn").current().size());
        assertTrue(hundredService.userStatus("kc-asia").current().isEmpty(),
                "跨服同号不得看见 CN 账号的百场记录");
        assertTrue(mark3Service.userStatus("kc-cn").current().isEmpty(),
                "跨服同号不得看见 ASIA 账号的三环记录");
        assertEquals(1, mark3Service.userStatus("kc-asia").current().size());

        hundredRepository.saveAndFlush(hundredSubmissionWithStatus(CN, WOTB_ACCOUNT_ID, "PENDING", 2L));
        assertEquals(1, hundredService.userStatus("kc-cn").current().size());
        assertEquals(1, hundredService.userStatus("kc-cn").pending().size());
    }

    private static UserProfile profile(final String keycloakUserId, final String server, final Long wotbAccountId) {
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId(keycloakUserId);
        profile.setUsername(keycloakUserId);
        profile.setWotbServer(server);
        profile.setWotbAccountId(wotbAccountId);
        profile.setWotbNickname(wotbAccountId == null ? null : "Player" + wotbAccountId);
        profile.setUpdatedAt(OffsetDateTime.now());
        return profile;
    }

    private static HallOfFameRecord singleRecord() {
        final HallOfFameRecord record = new HallOfFameRecord();
        record.setArenaId("invariant-arena");
        record.setTankId(6481L);
        record.setTankName("FV4005");
        record.setAccountId(WOTB_ACCOUNT_ID);
        record.setNickname("Player100");
        record.setBattleType("RANDOM");
        record.setArenaBonusType(1);
        record.setDamageDealt(5000);
        return record;
    }

    private static HundredBattleSubmission hundredSubmission(final String server, final long accountId) {
        return hundredSubmissionWithStatus(server, accountId, "CURRENT", 1L);
    }

    private static HundredBattleSubmission hundredSubmissionWithStatus(final String server, final long accountId,
                                                                      final String status, final long vehicleId) {
        final HundredBattleSubmission submission = new HundredBattleSubmission();
        submission.setVehicleId(vehicleId);
        submission.setVehicleName("FV4005");
        submission.setWotbServer(server);
        submission.setWotbAccountId(accountId);
        submission.setNicknameSnapshot("Player" + accountId);
        submission.setClaimedAverageDamage(3000);
        submission.setClaimedBattleCount(120);
        if ("CURRENT".equals(status)) {
            submission.setApprovedAverageDamage(3000);
            submission.setApprovedBattleCount(120);
            submission.setApprovedAt(OffsetDateTime.now());
        }
        submission.setStatus(status);
        return submission;
    }

    private static Mark3Submission mark3Submission(final String server, final long accountId) {
        final Mark3Submission submission = new Mark3Submission();
        submission.setVehicleId(6481L);
        submission.setVehicleName("FV4005");
        submission.setWotbServer(server);
        submission.setWotbAccountId(accountId);
        submission.setNicknameSnapshot("Player" + accountId);
        submission.setClaimedBattleCount(60);
        submission.setClaimedAverageDamage(3000);
        submission.setClaimedWinRate(new BigDecimal("65.50"));
        submission.setApprovedBattleCount(60);
        submission.setApprovedAverageDamage(3000);
        submission.setApprovedWinRate(new BigDecimal("65.50"));
        submission.setApprovedAt(OffsetDateTime.now());
        submission.setStatus("CURRENT");
        return submission;
    }
}

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
import com.wotb.web.user.service.UserProfileService;
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

/**
 * IAM 与 HoF 生命周期解耦的不变量（真实 PostgreSQL）。
 *
 * <p>本测试锁死本任务最重要的业务不变量：</p>
 * <pre>
 *   删除 Keycloak 用户  ≠  删除 HoF 业务记录
 * </pre>
 *
 * <p>完整链路：KC user A 绑定 WotB account 100 并留下单场 / 百场 / 三环记录 →
 * 删除 A 的 IAM 侧资料（{@code AdminUserService} 删除用户时的本地步骤）→
 * 三张 HoF 表数据必须原封不动 → 新 KC user B 重新绑定同一 WotB account 100 →
 * B 通过 account-based 查询重新看到原记录。</p>
 */
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

    @Autowired
    UserProfileRepository userProfileRepository;

    @Autowired
    UserProfileService userProfileService;

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
        // 1) KC user A 绑定 WotB account 100，并留下三类 HoF 记录
        userProfileRepository.saveAndFlush(profile("kc-user-a", WOTB_ACCOUNT_ID));
        recordRepository.saveAndFlush(singleRecord());
        hundredRepository.saveAndFlush(hundredSubmission());
        mark3Repository.saveAndFlush(mark3Submission());

        // 2) 删除 A 的 IAM 侧资料 —— AdminUserService.deleteOneInternal 的本地步骤，
        //    也是「删除 Keycloak 用户」唯一会触达 HoF 的路径
        final UserProfile removed = userProfileRepository.findByKeycloakUserId("kc-user-a").orElseThrow();
        userProfileService.deleteForAdministration(removed);

        // 3) 不变量：HoF 数据一行都不能少
        assertEquals(1, recordRepository.count(), "删除 Keycloak 用户不得删除单场记录");
        assertEquals(1, hundredRepository.count(), "删除 Keycloak 用户不得删除百场 submission");
        assertEquals(1, mark3Repository.count(), "删除 Keycloak 用户不得删除三环 submission");

        // 4) 唯一槽位被释放：新 KC user B 可以绑定同一个 WotB account 100
        userProfileRepository.saveAndFlush(profile("kc-user-b", WOTB_ACCOUNT_ID));
        assertEquals(WOTB_ACCOUNT_ID,
                userProfileRepository.findByKeycloakUserId("kc-user-b").orElseThrow().getWotbAccountId());

        // 5) 唯一性依然被强制：第三个用户不能同时占用同一账号
        assertThrows(DataIntegrityViolationException.class,
                () -> userProfileRepository.saveAndFlush(profile("kc-user-c", WOTB_ACCOUNT_ID)));

        // 6) B 重新看到 account-based HoF 记录（ownership 与 Keycloak 身份无关）
        assertEquals(1, hallOfFameService.recordsByAccountId(WOTB_ACCOUNT_ID, 50).size(),
                "新用户绑定同一 WotB 账号后应重新看到单场记录");
        assertEquals(1, hundredService.userStatus("kc-user-b").current().size(),
                "新用户绑定同一 WotB 账号后应重新看到百场 CURRENT");
        assertEquals(1, mark3Service.userStatus("kc-user-b").current().size(),
                "新用户绑定同一 WotB 账号后应重新看到三环 CURRENT");

        // 7) 未绑定任何账号的用户看不到任何 HoF 记录（不得按 Keycloak 身份兜底）
        userProfileRepository.saveAndFlush(profile("kc-user-d", null));
        assertTrue(hundredService.userStatus("kc-user-d").current().isEmpty());
        assertTrue(mark3Service.userStatus("kc-user-d").current().isEmpty());
    }

    private static UserProfile profile(final String keycloakUserId, final Long wotbAccountId) {
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId(keycloakUserId);
        profile.setUsername(keycloakUserId);
        profile.setWotbServer("CN");
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

    private static HundredBattleSubmission hundredSubmission() {
        final HundredBattleSubmission submission = new HundredBattleSubmission();
        submission.setVehicleId(6481L);
        submission.setVehicleName("FV4005");
        submission.setWotbAccountId(WOTB_ACCOUNT_ID);
        submission.setNicknameSnapshot("Player100");
        submission.setClaimedAverageDamage(3000);
        submission.setClaimedBattleCount(120);
        submission.setApprovedAverageDamage(3000);
        submission.setApprovedBattleCount(120);
        submission.setApprovedAt(OffsetDateTime.now());
        submission.setStatus("CURRENT");
        return submission;
    }

    private static Mark3Submission mark3Submission() {
        final Mark3Submission submission = new Mark3Submission();
        submission.setVehicleId(6481L);
        submission.setVehicleName("FV4005");
        submission.setWotbAccountId(WOTB_ACCOUNT_ID);
        submission.setNicknameSnapshot("Player100");
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

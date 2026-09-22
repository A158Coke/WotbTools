package com.wotb.web.user.service;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.web.user.dto.UserProfileDto;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.repository.UserProfileRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UserProfileServiceTest {

    private UserProfileRepository repository;
    private UserProfileService service;

    @BeforeEach
    void setUp() {
        repository = mock(UserProfileRepository.class);
        when(repository.save(any(UserProfile.class))).thenAnswer(inv -> inv.getArgument(0));
        when(repository.saveAndFlush(any(UserProfile.class))).thenAnswer(inv -> inv.getArgument(0));
        service = new UserProfileService(repository, new UserProfileMapper());
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void currentWotbIdentityReturnsTheBoundServerAndAccount() {
        when(repository.findByKeycloakUserId("kc-user"))
                .thenReturn(Optional.of(wgProfile("ASIA", 123456L, "PlayerOne", null)));

        final WotbAccountIdentity identity = service.currentWotbIdentity("kc-user").orElseThrow();

        // 区服是业务身份的一部分：只返回账号 ID 会让 (CN, 123456) 与 (ASIA, 123456) 串号
        assertEquals("ASIA", identity.server());
        assertEquals(123456L, identity.accountId());
    }

    @Test
    void currentWotbIdentityIsEmptyWithoutAProfile() {
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.empty());

        assertTrue(service.currentWotbIdentity("kc-user").isEmpty());
    }

    @Test
    void currentWotbIdentityIsEmptyWhenNoAccountIsBound() {
        when(repository.findByKeycloakUserId("kc-user"))
                .thenReturn(Optional.of(wgProfile("CN", null, null, null)));
        assertTrue(service.currentWotbIdentity("kc-user").isEmpty(),
                "未绑定账号不得解析出 canonical 身份，否则会按 0 号账号归属");

        when(repository.findByKeycloakUserId("kc-user"))
                .thenReturn(Optional.of(wgProfile("CN", 0L, null, null)));
        assertTrue(service.currentWotbIdentity("kc-user").isEmpty());
    }

    private static void loginWithWgClaims(final String region, final boolean verified,
                                          final Long accountId) {
        final Jwt jwt = Jwt.withTokenValue("token")
                .header("alg", "none")
                .subject("kc-user")
                .claim("preferred_username", "512345678")
                .claim("displayName", "PlayerOne")
                .claim("wotb_region", region)
                .claim("wotb_account_id", accountId == null ? null : String.valueOf(accountId))
                .claim("wotb_nickname", "PlayerOne")
                .claim("wotb_verified", verified)
                .build();
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(jwt, null));
    }

    private static UserProfile wgProfile(final String region, final Long accountId,
                                         final String nickname,
                                         final OffsetDateTime verifiedAt) {
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId("kc-user");
        profile.setUsername("512345678");
        profile.setWotbServer(region);
        profile.setWotbAccountId(accountId);
        profile.setWotbNickname(nickname);
        profile.setWotbAccountSource("WARGAMING");
        profile.setWotbAccountVerifiedAt(verifiedAt);
        return profile;
    }

    /** CN / QQ 手动绑定 profile（回放验证的目标形态）。 */
    private static UserProfile cnProfile(final Long accountId, final String nickname,
                                         final OffsetDateTime verifiedAt) {
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId("kc-user");
        profile.setUsername("qq-user");
        profile.setWotbServer("CN");
        profile.setWotbAccountId(accountId);
        profile.setWotbNickname(nickname);
        profile.setWotbAccountSource("MANUAL");
        profile.setWotbAccountVerifiedAt(verifiedAt);
        return profile;
    }

    /**
     * 一场可解析出录像者的战斗：{@code recorderNickname} 对应的名册行 accountId =
     * {@code recorderAccountId}；{@code otherAccountId} 非 null 时再放一行「同局名册里的另一个账号」。
     */
    private static Battle battle(final String recorderNickname, final long recorderAccountId,
                                 final Long otherAccountId) {
        final Battle battle = new Battle();
        battle.recorder = recorderNickname;
        final List<PlayerResult> players = new ArrayList<>();
        final PlayerResult recorder = new PlayerResult();
        recorder.accountId = recorderAccountId;
        recorder.nickname = recorderNickname;
        players.add(recorder);
        if (otherAccountId != null) {
            final PlayerResult other = new PlayerResult();
            other.accountId = otherAccountId;
            other.nickname = "Other";
            players.add(other);
        }
        battle.players = players;
        return battle;
    }

    /** 录像者无法解析：meta 昵称在名册里匹配不到任何一行 → recorderResult() = null。 */
    private static Battle battleWithUnresolvedRecorder(final long rosterAccountId) {
        final Battle battle = new Battle();
        battle.recorder = "Recorder";
        final PlayerResult player = new PlayerResult();
        player.accountId = rosterAccountId;
        player.nickname = "SomeoneElse";
        battle.players = List.of(player);
        return battle;
    }

    // ── ensure：canonical provisioning（无 profile 时创建） ────────────────

    @Test
    void ensureWithoutClaimsStaysCnManual() {
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.empty());

        final UserProfileDto dto = service.ensureCurrentProfile("kc-user", "cn-user", "CN Player");

        assertEquals("CN", dto.wotbServer());
        assertEquals("MANUAL", dto.wotbAccountSource());
        assertNull(dto.wotbAccountVerifiedAt());
    }

    @Test
    void ensureWithTrustedClaimsCreatesAsiaWargaming() {
        loginWithWgClaims("ASIA", true, 512345678L);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.empty());

        final UserProfileDto dto = service.ensureCurrentProfile("kc-user", "512345678", "PlayerOne");

        assertEquals("ASIA", dto.wotbServer());
        assertEquals(512345678L, dto.wotbAccountId());
        assertEquals("PlayerOne", dto.wotbNickname());
        assertEquals("WARGAMING", dto.wotbAccountSource());
        assertNotNull(dto.wotbAccountVerifiedAt());
    }

    @Test
    void ensureWithTrustedEuClaimsCreatesEuWargaming() {
        loginWithWgClaims("EU", true, 512345678L);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.empty());

        final UserProfileDto dto = service.ensureCurrentProfile("kc-user", "512345678", "PlayerOne");

        assertEquals("EU", dto.wotbServer());
        assertEquals("WARGAMING", dto.wotbAccountSource());
        assertNotNull(dto.wotbAccountVerifiedAt());
    }

    @Test
    void ensureWithTrustedNaClaimsCreatesNaWargaming() {
        loginWithWgClaims("NA", true, 512345678L);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.empty());

        final UserProfileDto dto = service.ensureCurrentProfile("kc-user", "512345678", "PlayerOne");

        assertEquals("NA", dto.wotbServer());
        assertEquals("WARGAMING", dto.wotbAccountSource());
        assertNotNull(dto.wotbAccountVerifiedAt());
    }

    @Test
    void ensureWithMissingVerifiedFallsBackToCn() {
        loginWithWgClaims("ASIA", false, 512345678L);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.empty());

        final UserProfileDto dto = service.ensureCurrentProfile("kc-user", "cn-user", "CN Player");

        assertEquals("CN", dto.wotbServer());
        assertEquals("MANUAL", dto.wotbAccountSource());
        assertNull(dto.wotbAccountVerifiedAt());
    }

    // ── ensure：真正幂等（已存在 → 原样返回，不改绑定） ──────────────────

    @Test
    void ensureReturnsExistingProfileWithoutTouchingBindings() {
        final OffsetDateTime verifiedAt = OffsetDateTime.parse("2026-01-01T00:00:00Z");
        when(repository.findByKeycloakUserId("kc-user"))
                .thenReturn(Optional.of(wgProfile("ASIA", 123456L, "PlayerOne", verifiedAt)));
        // 即使当前 JWT 的可信 claims 指向另一个区服/账号，也不得覆盖既有绑定。
        loginWithWgClaims("EU", true, 999L);

        final UserProfileDto dto = service.ensureCurrentProfile("kc-user", "other", "Other");

        assertEquals("ASIA", dto.wotbServer());
        assertEquals(123456L, dto.wotbAccountId());
        assertEquals("PlayerOne", dto.wotbNickname());
        assertEquals("WARGAMING", dto.wotbAccountSource());
        assertEquals(verifiedAt, dto.wotbAccountVerifiedAt());
        verify(repository, never()).saveAndFlush(any(UserProfile.class));
    }

    @Test
    void ensureIsIdempotentAcrossRepeatedCalls() {
        when(repository.findByKeycloakUserId("kc-user"))
                .thenReturn(Optional.of(wgProfile("CN", 7L, null, null)));

        assertEquals(7L, service.ensureCurrentProfile("kc-user", "u", "U").wotbAccountId());
        assertEquals(7L, service.ensureCurrentProfile("kc-user", "u", "U").wotbAccountId());
        verify(repository, never()).saveAndFlush(any(UserProfile.class));
    }

    // ── ensure：并发与身份冲突的区分 ────────────────────────────────────

    @Test
    void ensureReloadsExistingProfileWhenAnotherRequestWonTheKeycloakUserRace() {
        // 并发败者路径：find → 不存在；插入冲突；胜者已提交。
        // 刻意用一个**不含任何已知约束名**的冲突消息：收敛判定必须来自「重读自己的 sub」这一
        // 数据库事实，而不是 PostgreSQL 先报告了哪个约束。
        when(repository.findByKeycloakUserId("kc-user"))
                .thenReturn(Optional.empty())
                .thenReturn(Optional.of(wgProfile("CN", 7L, null, null)));
        when(repository.saveAndFlush(any(UserProfile.class)))
                .thenThrow(new DataIntegrityViolationException("duplicate key value violates unique constraint"));

        final UserProfileDto dto = service.ensureCurrentProfile("kc-user", "u", "U");

        // 同一 KC sub 的并发 ensure 必须两个调用方都成功，而不是返回 PROFILE_ALREADY_EXISTS。
        assertEquals(7L, dto.wotbAccountId());
        assertEquals("kc-user", dto.keycloakUserId());
    }

    @Test
    void ensureKeepsWotbAccountCollisionAsRealConflict() {
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.empty());
        when(repository.saveAndFlush(any(UserProfile.class)))
                .thenThrow(new DataIntegrityViolationException(
                        "duplicate key value violates unique constraint \"uk_user_profile_wotb_account\""));

        final IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> service.ensureCurrentProfile("kc-user", "u", "U"));

        // 真实 WotB 账号占用绝不能被幂等逻辑吞掉，也绝不返回他人的 profile。
        assertEquals("WOTB_ACCOUNT_ALREADY_USED", error.getMessage());
    }

    @Test
    void ensureReportsUnknownIntegrityViolationAsBootstrapFailure() {
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.empty());
        // 自己的 sub 不存在，且冲突不是 WotB 账号占用 → 不得伪装成 409 业务冲突。
        when(repository.saveAndFlush(any(UserProfile.class)))
                .thenThrow(new DataIntegrityViolationException(
                        "new row for relation \"user_profile\" violates check constraint \"ck_user_profile_wotb_server\""));

        final IllegalStateException error = assertThrows(IllegalStateException.class,
                () -> service.ensureCurrentProfile("kc-user", "u", "U"));

        assertEquals("PROFILE_BOOTSTRAP_FAILED", error.getMessage());
    }

    @Test
    void syncFromLoginRejectsNonWgClaims() {
        SecurityContextHolder.clearContext();
        assertThrows(IllegalArgumentException.class, () -> service.syncFromLogin("kc-user"),
                "WOTB_CLAIMS_INVALID");
    }

    @Test
    void syncFromLoginUpdatesNicknameWithoutRefreshingVerifiedAt() {
        loginWithWgClaims("ASIA", true, 512345678L);
        final OffsetDateTime original = OffsetDateTime.now().minusDays(7);
        final UserProfile existing = wgProfile("ASIA", 512345678L, "OldName", original);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(existing));
        when(repository.existsByWotbServerAndWotbAccountIdAndKeycloakUserIdNot(
                "ASIA", 512345678L, "kc-user")).thenReturn(false);

        final UserProfileDto dto = service.syncFromLogin("kc-user");

        assertEquals("PlayerOne", dto.wotbNickname());
        assertEquals(original, dto.wotbAccountVerifiedAt());
    }

    @Test
    void syncFromLoginUpdatesEuProfileNickname() {
        loginWithWgClaims("EU", true, 512345678L);
        final OffsetDateTime original = OffsetDateTime.now().minusDays(7);
        final UserProfile existing = wgProfile("EU", 512345678L, "OldName", original);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(existing));
        when(repository.existsByWotbServerAndWotbAccountIdAndKeycloakUserIdNot(
                "EU", 512345678L, "kc-user")).thenReturn(false);

        final UserProfileDto dto = service.syncFromLogin("kc-user");

        assertEquals("EU", dto.wotbServer());
        assertEquals("PlayerOne", dto.wotbNickname());
        assertEquals(original, dto.wotbAccountVerifiedAt());
    }

    @Test
    void syncFromLoginIsIdempotentWhenNicknameUnchanged() {
        loginWithWgClaims("ASIA", true, 512345678L);
        final OffsetDateTime original = OffsetDateTime.now().minusDays(7);
        final UserProfile existing = wgProfile("ASIA", 512345678L, "PlayerOne", original);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(existing));
        when(repository.existsByWotbServerAndWotbAccountIdAndKeycloakUserIdNot(
                "ASIA", 512345678L, "kc-user")).thenReturn(false);

        final UserProfileDto dto = service.syncFromLogin("kc-user");

        assertEquals("PlayerOne", dto.wotbNickname());
        assertEquals(original, dto.wotbAccountVerifiedAt());
    }

    @Test
    void syncFromLoginUpgradesEmptyProfileToWargaming() {
        loginWithWgClaims("ASIA", true, 512345678L);
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId("kc-user");
        profile.setWotbServer("CN");
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));
        when(repository.existsByWotbServerAndWotbAccountIdAndKeycloakUserIdNot(
                "ASIA", 512345678L, "kc-user")).thenReturn(false);

        final UserProfileDto dto = service.syncFromLogin("kc-user");

        assertEquals("ASIA", dto.wotbServer());
        assertEquals(512345678L, dto.wotbAccountId());
        assertEquals("PlayerOne", dto.wotbNickname());
        assertEquals("WARGAMING", dto.wotbAccountSource());
        assertNotNull(dto.wotbAccountVerifiedAt());
    }

    @Test
    void syncFromLoginCreatesWargamingProfileWhenMissing() {
        loginWithWgClaims("NA", true, 572253806L);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.empty());
        when(repository.existsByWotbServerAndWotbAccountIdAndKeycloakUserIdNot(
                "NA", 572253806L, "kc-user")).thenReturn(false);

        final UserProfileDto dto = service.syncFromLogin("kc-user");

        assertEquals("NA", dto.wotbServer());
        assertEquals(572253806L, dto.wotbAccountId());
        assertEquals("PlayerOne", dto.wotbNickname());
        assertEquals("WARGAMING", dto.wotbAccountSource());
        assertNotNull(dto.wotbAccountVerifiedAt());
    }

    @Test
    void syncFromLoginRefusesAlreadyBoundCnProfile() {
        loginWithWgClaims("ASIA", true, 512345678L);
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId("kc-user");
        profile.setWotbServer("CN");
        profile.setWotbAccountId(1001L);
        profile.setWotbAccountSource("MANUAL");
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));
        when(repository.existsByWotbServerAndWotbAccountIdAndKeycloakUserIdNot(
                "ASIA", 512345678L, "kc-user")).thenReturn(false);

        final IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> service.syncFromLogin("kc-user"));
        assertEquals("PROFILE_REGION_MISMATCH", e.getMessage());
    }

    @Test
    void syncFromLoginRefusesAccountSwitch() {
        loginWithWgClaims("ASIA", true, 999L);
        final UserProfile existing = wgProfile("ASIA", 512345678L, "PlayerOne",
                OffsetDateTime.now().minusDays(1));
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(existing));

        final IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> service.syncFromLogin("kc-user"));
        assertEquals("WOTB_ACCOUNT_MISMATCH", e.getMessage());
    }

    @Test
    void syncFromLoginRefusesRegionMismatch() {
        loginWithWgClaims("EU", true, 512345678L);
        final UserProfile existing = wgProfile("ASIA", 512345678L, "PlayerOne",
                OffsetDateTime.now().minusDays(1));
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(existing));

        final IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> service.syncFromLogin("kc-user"));
        assertEquals("PROFILE_REGION_MISMATCH", e.getMessage());
    }

    @Test
    void syncFromLoginReturnsConflictWhenAccountUsedByOtherUser() {
        loginWithWgClaims("ASIA", true, 512345678L);
        final UserProfile existing = wgProfile("ASIA", 512345678L, "PlayerOne",
                OffsetDateTime.now().minusDays(1));
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(existing));
        when(repository.existsByWotbServerAndWotbAccountIdAndKeycloakUserIdNot(
                "ASIA", 512345678L, "kc-user")).thenReturn(true);

        final IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> service.syncFromLogin("kc-user"));
        assertEquals("WOTB_ACCOUNT_ALREADY_USED", e.getMessage());
    }

    @Test
    void updateWotbAccountRejectsAsiaProfile() {
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(
                Optional.of(wgProfile("ASIA", 512345678L, "PlayerOne", OffsetDateTime.now())));

        final IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> service.updateWotbAccount("kc-user", 888L, "Fake", "ASIA"));
        assertEquals("ASIA_PROFILE_READONLY", e.getMessage());
    }

    @Test
    void updateWotbAccountRejectsEuProfileWithGenericReadonlyCode() {
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(
                Optional.of(wgProfile("EU", 512345678L, "PlayerOne", OffsetDateTime.now())));

        final IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> service.updateWotbAccount("kc-user", 888L, "Fake", "EU"));
        assertEquals("WARGAMING_PROFILE_READONLY", e.getMessage());
    }

    @Test
    void updateWotbAccountRejectsWgJwtEvenWhenDbProfileIsManual() {
        loginWithWgClaims("ASIA", true, 572253806L);
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId("kc-user");
        profile.setWotbServer("CN");
        profile.setWotbAccountSource("MANUAL");
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));

        final IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> service.updateWotbAccount("kc-user", 1001L, "CNName", "CN"));
        assertEquals("WARGAMING_PROFILE_READONLY", e.getMessage());
    }

    @Test
    void deleteWotbAccountRejectsAsiaProfile() {
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(
                Optional.of(wgProfile("ASIA", 512345678L, "PlayerOne", OffsetDateTime.now())));

        final IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> service.deleteWotbAccount("kc-user"));
        assertEquals("ASIA_PROFILE_READONLY", e.getMessage());
    }

    @Test
    void deleteWotbAccountRejectsNaProfileWithGenericReadonlyCode() {
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(
                Optional.of(wgProfile("NA", 512345678L, "PlayerOne", OffsetDateTime.now())));

        final IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> service.deleteWotbAccount("kc-user"));
        assertEquals("WARGAMING_PROFILE_READONLY", e.getMessage());
    }

    @Test
    void deleteWotbAccountRejectsWgJwtEvenWhenDbProfileIsManual() {
        loginWithWgClaims("EU", true, 572253806L);
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId("kc-user");
        profile.setWotbServer("CN");
        profile.setWotbAccountSource("MANUAL");
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));

        final IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> service.deleteWotbAccount("kc-user"));
        assertEquals("WARGAMING_PROFILE_READONLY", e.getMessage());
    }

    @Test
    void updateWotbAccountStillWorksForCn() {
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId("kc-user");
        profile.setWotbServer("CN");
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));
        when(repository.existsByWotbServerAndWotbAccountIdAndKeycloakUserIdNot(
                "CN", 1001L, "kc-user")).thenReturn(false);

        final UserProfileDto dto = service.updateWotbAccount("kc-user", 1001L, "CNName", "cn");

        assertEquals("CN", dto.wotbServer());
        assertEquals(1001L, dto.wotbAccountId());
        assertEquals("CNName", dto.wotbNickname());
        assertEquals("MANUAL", dto.wotbAccountSource());
    }

    // ── 回放录制者验证：只有「数值 accountId 相等」才通过 ──────────────────

    @Test
    void replayRecordedByTheBoundAccountVerifiesIt() {
        final UserProfile profile = cnProfile(123L, "CNName", null);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));

        service.verifyBoundAccountFromReplay("kc-user", List.of(battle("Recorder", 123L, null)));

        assertNotNull(profile.getWotbAccountVerifiedAt());
        verify(repository).save(profile);
    }

    @Test
    void replayRecordedByAnotherAccountLeavesTheBindingUnverified() {
        final UserProfile profile = cnProfile(123L, "CNName", null);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));

        service.verifyBoundAccountFromReplay("kc-user", List.of(battle("Recorder", 456L, null)));

        assertNull(profile.getWotbAccountVerifiedAt());
        verify(repository, never()).save(any(UserProfile.class));
    }

    @Test
    void batchWithOneReplayFromTheBoundAccountVerifiesIt() {
        // 多文件批次里只有一场是本人录制的：任一场匹配即成立，不必是第一场。
        final UserProfile profile = cnProfile(123L, "CNName", null);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));

        service.verifyBoundAccountFromReplay("kc-user",
                List.of(battle("Friend", 456L, null), battle("Recorder", 123L, null)));

        assertNotNull(profile.getWotbAccountVerifiedAt());
    }

    @Test
    void replayWithUnresolvedRecorderLeavesTheBindingUnverified() {
        final UserProfile profile = cnProfile(123L, "CNName", null);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));

        service.verifyBoundAccountFromReplay("kc-user", List.of(battleWithUnresolvedRecorder(123L)));
        service.verifyBoundAccountFromReplay("kc-user", List.of());
        service.verifyBoundAccountFromReplay("kc-user", null);

        assertNull(profile.getWotbAccountVerifiedAt());
        verify(repository, never()).save(any(UserProfile.class));
    }

    @Test
    void accountPresentInRosterButNotTheRecorderMustNotVerify() {
        // bound = 123 而 123 确实在这份回放的名册里，但录像者是 456：名册出现不等于录制者。
        final UserProfile profile = cnProfile(123L, "CNName", null);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));

        service.verifyBoundAccountFromReplay("kc-user", List.of(battle("Recorder", 456L, 123L)));

        assertNull(profile.getWotbAccountVerifiedAt());
        verify(repository, never()).save(any(UserProfile.class));
    }

    @Test
    void unauthenticatedOrUnboundUserIsNeverVerified() {
        final UserProfile unbound = cnProfile(null, null, null);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(unbound));

        service.verifyBoundAccountFromReplay(null, List.of(battle("Recorder", 123L, null)));
        service.verifyBoundAccountFromReplay("kc-user", List.of(battle("Recorder", 123L, null)));

        assertNull(unbound.getWotbAccountVerifiedAt());
        verify(repository, never()).save(any(UserProfile.class));
    }

    @Test
    void alreadyVerifiedAccountKeepsItsFirstVerificationTimestamp() {
        final OffsetDateTime firstVerifiedAt = OffsetDateTime.parse("2026-03-03T03:03:03Z");
        final UserProfile profile = cnProfile(123L, "CNName", firstVerifiedAt);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));

        service.verifyBoundAccountFromReplay("kc-user", List.of(battle("Recorder", 123L, null)));

        assertEquals(firstVerifiedAt, profile.getWotbAccountVerifiedAt());
        verify(repository, never()).save(any(UserProfile.class));
    }

    // ── 绑定身份变化使验证失效 ────────────────────────────────────────────

    @Test
    void switchingTheBoundAccountClearsReplayVerification() {
        final UserProfile profile = cnProfile(123L, "CNName",
                OffsetDateTime.parse("2026-03-03T03:03:03Z"));
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));
        when(repository.existsByWotbServerAndWotbAccountIdAndKeycloakUserIdNot(
                "CN", 456L, "kc-user")).thenReturn(false);

        final UserProfileDto dto = service.updateWotbAccount("kc-user", 456L, "NewName", "CN");

        assertEquals(456L, dto.wotbAccountId());
        assertNull(dto.wotbAccountVerifiedAt(), "换绑后旧的验证不得存活");
    }

    @Test
    void unbindingTheAccountClearsReplayVerification() {
        final UserProfile profile = cnProfile(123L, "CNName",
                OffsetDateTime.parse("2026-03-03T03:03:03Z"));
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));

        final UserProfileDto dto = service.deleteWotbAccount("kc-user");

        assertNull(dto.wotbAccountId());
        assertNull(dto.wotbAccountVerifiedAt());
    }

    @Test
    void nicknameOnlyEditKeepsReplayVerification() {
        final OffsetDateTime verifiedAt = OffsetDateTime.parse("2026-03-03T03:03:03Z");
        final UserProfile profile = cnProfile(123L, "OldName", verifiedAt);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));
        when(repository.existsByWotbServerAndWotbAccountIdAndKeycloakUserIdNot(
                "CN", 123L, "kc-user")).thenReturn(false);

        final UserProfileDto dto = service.updateWotbAccount("kc-user", 123L, "NewName", "CN");

        assertEquals("NewName", dto.wotbNickname());
        assertEquals(verifiedAt, dto.wotbAccountVerifiedAt(), "与账号身份无关的资料修改不得清空验证");
    }

    @Test
    void ensureDoesNotDisturbReplayVerification() {
        final OffsetDateTime verifiedAt = OffsetDateTime.parse("2026-03-03T03:03:03Z");
        when(repository.findByKeycloakUserId("kc-user"))
                .thenReturn(Optional.of(cnProfile(123L, "CNName", verifiedAt)));

        final UserProfileDto dto = service.ensureCurrentProfile("kc-user", "qq-user", "New Display Name");

        assertEquals(123L, dto.wotbAccountId());
        assertEquals(verifiedAt, dto.wotbAccountVerifiedAt());
        verify(repository, never()).saveAndFlush(any(UserProfile.class));
    }
}

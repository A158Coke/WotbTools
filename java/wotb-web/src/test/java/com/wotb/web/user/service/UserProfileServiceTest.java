package com.wotb.web.user.service;

import com.wotb.web.user.dto.UserProfileDto;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.repository.UserProfileRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.OffsetDateTime;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class UserProfileServiceTest {

    private UserProfileRepository repository;
    private UserProfileService service;

    @BeforeEach
    void setUp() {
        repository = mock(UserProfileRepository.class);
        when(repository.save(any(UserProfile.class))).thenAnswer(inv -> inv.getArgument(0));
        service = new UserProfileService(repository, new UserProfileMapper());
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
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

    @Test
    void createWithoutClaimsStaysCnManual() {
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.empty());

        final UserProfileDto dto = service.create("kc-user", "cn-user", "CN Player");

        assertEquals("CN", dto.wotbServer());
        assertEquals("MANUAL", dto.wotbAccountSource());
        assertNull(dto.wotbAccountVerifiedAt());
    }

    @Test
    void createWithTrustedClaimsCreatesAsiaWargaming() {
        loginWithWgClaims("ASIA", true, 512345678L);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.empty());

        final UserProfileDto dto = service.create("kc-user", "512345678", "PlayerOne");

        assertEquals("ASIA", dto.wotbServer());
        assertEquals(512345678L, dto.wotbAccountId());
        assertEquals("PlayerOne", dto.wotbNickname());
        assertEquals("WARGAMING", dto.wotbAccountSource());
        assertNotNull(dto.wotbAccountVerifiedAt());
    }

    @Test
    void createWithTrustedEuClaimsCreatesEuWargaming() {
        loginWithWgClaims("EU", true, 512345678L);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.empty());

        final UserProfileDto dto = service.create("kc-user", "512345678", "PlayerOne");

        assertEquals("EU", dto.wotbServer());
        assertEquals("WARGAMING", dto.wotbAccountSource());
        assertNotNull(dto.wotbAccountVerifiedAt());
    }

    @Test
    void createWithTrustedNaClaimsCreatesNaWargaming() {
        loginWithWgClaims("NA", true, 512345678L);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.empty());

        final UserProfileDto dto = service.create("kc-user", "512345678", "PlayerOne");

        assertEquals("NA", dto.wotbServer());
        assertEquals("WARGAMING", dto.wotbAccountSource());
        assertNotNull(dto.wotbAccountVerifiedAt());
    }

    @Test
    void createWithMissingVerifiedFallsBackToCn() {
        loginWithWgClaims("ASIA", false, 512345678L);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.empty());

        final UserProfileDto dto = service.create("kc-user", "cn-user", "CN Player");

        assertEquals("CN", dto.wotbServer());
        assertEquals("MANUAL", dto.wotbAccountSource());
        assertNull(dto.wotbAccountVerifiedAt());
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
    void syncFromLoginRefusesCnProfile() {
        loginWithWgClaims("ASIA", true, 512345678L);
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId("kc-user");
        profile.setWotbServer("CN");
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));

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
}

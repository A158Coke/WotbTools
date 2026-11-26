package com.wotb.web.user.service;

import com.wotb.web.user.dto.UserProfileDto;
import com.wotb.web.user.entity.UserProfile;
import java.time.OffsetDateTime;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.core.context.SecurityContextHolder;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UserProfileLoginSyncTest extends UserProfileServiceTestSupport {

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

    @Test
    void ensureReturnsExistingProfileWithoutTouchingBindings() {
        final OffsetDateTime verifiedAt = OffsetDateTime.parse("2026-01-01T00:00:00Z");
        when(repository.findByKeycloakUserId("kc-user"))
                .thenReturn(Optional.of(wgProfile("ASIA", 123456L, "PlayerOne", verifiedAt)));
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

    @Test
    void ensureReloadsExistingProfileWhenAnotherRequestWonTheKeycloakUserRace() {
        when(repository.findByKeycloakUserId("kc-user"))
                .thenReturn(Optional.empty())
                .thenReturn(Optional.of(wgProfile("CN", 7L, null, null)));
        when(repository.saveAndFlush(any(UserProfile.class)))
                .thenThrow(new DataIntegrityViolationException("duplicate key value violates unique constraint"));

        final UserProfileDto dto = service.ensureCurrentProfile("kc-user", "u", "U");

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

        assertEquals("WOTB_ACCOUNT_ALREADY_USED", error.getMessage());
    }

    @Test
    void ensureReportsUnknownIntegrityViolationAsBootstrapFailure() {
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.empty());
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
}

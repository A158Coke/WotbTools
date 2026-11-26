package com.wotb.web.user.service;

import com.wotb.web.user.dto.UserProfileDto;
import com.wotb.web.user.entity.UserProfile;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UserProfileBindingVerificationTest extends UserProfileServiceTestSupport {

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

    @Test
    void verificationIsAClientAssertedComparisonNotAReplayAuthenticityCheck() {
        final UserProfile profile = cnProfile(123L, "CNName", null);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));

        service.verifyWotbAccountFromReplay("kc-user", 123L);

        assertNotNull(profile.getWotbAccountVerifiedAt());
        assertEquals(java.util.List.of(String.class, Long.class), java.util.Arrays.asList(
                java.util.Arrays.stream(UserProfileService.class.getDeclaredMethods())
                        .filter(m -> m.getName().equals("verifyWotbAccountFromReplay"))
                        .findFirst().orElseThrow().getParameterTypes()));
    }

    @Test
    void replayRecordedByTheBoundAccountVerifiesIt() {
        final UserProfile profile = cnProfile(123L, "CNName", null);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));

        final UserProfileDto dto = service.verifyWotbAccountFromReplay("kc-user", 123L);

        assertNotNull(profile.getWotbAccountVerifiedAt());
        assertNotNull(dto.wotbAccountVerifiedAt());
        verify(repository).save(profile);
    }

    @Test
    void replayRecordedByAnotherAccountIsRejected() {
        final UserProfile profile = cnProfile(123L, "CNName", null);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));

        final IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> service.verifyWotbAccountFromReplay("kc-user", 456L));

        assertEquals("REPLAY_RECORDER_MISMATCH", e.getMessage());
        assertNull(profile.getWotbAccountVerifiedAt());
        verify(repository, never()).save(any(UserProfile.class));
    }

    @Test
    void missingRecorderOrUnboundAccountIsRejected() {
        final UserProfile unbound = cnProfile(null, null, null);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(unbound));

        assertEquals("REPLAY_RECORDER_REQUIRED", assertThrows(IllegalArgumentException.class,
                () -> service.verifyWotbAccountFromReplay("kc-user", null)).getMessage());
        assertEquals("WOTB_ACCOUNT_NOT_BOUND", assertThrows(IllegalArgumentException.class,
                () -> service.verifyWotbAccountFromReplay("kc-user", 123L)).getMessage());
        verify(repository, never()).save(any(UserProfile.class));
    }

    @Test
    void alreadyVerifiedKeepsTheFirstVerificationTime() {
        final OffsetDateTime first = OffsetDateTime.parse("2026-01-01T00:00:00Z");
        final UserProfile profile = cnProfile(123L, "CNName", null);
        profile.setWotbAccountVerifiedAt(first);
        when(repository.findByKeycloakUserId("kc-user")).thenReturn(Optional.of(profile));

        service.verifyWotbAccountFromReplay("kc-user", 123L);

        assertEquals(first, profile.getWotbAccountVerifiedAt());
        verify(repository, never()).save(any(UserProfile.class));
    }

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

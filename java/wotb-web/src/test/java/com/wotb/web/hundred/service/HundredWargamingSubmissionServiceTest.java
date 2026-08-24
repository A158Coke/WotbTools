package com.wotb.web.hundred.service;

import com.wotb.web.hundred.dto.HundredWargamingSubmissionRequest;
import com.wotb.web.hundred.dto.HundredWargamingSubmissionResult;
import com.wotb.web.hundred.gateway.WargamingOfficialStats;
import com.wotb.web.hundred.gateway.WargamingServer;
import com.wotb.web.hundred.gateway.WargamingStatsHttpGateway;
import com.wotb.web.user.entity.UserProfile;
import com.wotb.web.user.service.UserProfileService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** WG 自动认证身份、资格与外部调用前后边界。 */
@ExtendWith(MockitoExtension.class)
class HundredWargamingSubmissionServiceTest {

    private static final String USER = "kc-user";
    private static final long ACCOUNT = 512_345_678L;
    private static final long VEHICLE = 385L;

    @Mock
    UserProfileService userProfileService;

    @Mock
    WargamingStatsHttpGateway gateway;

    @Mock
    HundredBattleSubmissionService submissionService;

    HundredWargamingSubmissionService service;

    @BeforeEach
    void setUp() {
        service = new HundredWargamingSubmissionService(
                userProfileService, gateway, submissionService);
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void trustedIdentityUsesOfficialStatsAndKeepsClaimedOnlyAsAudit() {
        login(true, "ASIA", ACCOUNT, "PlayerOne");
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        final WargamingOfficialStats official = stats(5_000, 100, 390_000);
        when(gateway.fetch(WargamingServer.ASIA, ACCOUNT, VEHICLE)).thenReturn(official);
        when(submissionService.createWargamingSubmission(
                eq(USER), eq(1_234), eq(7), eq(official), any(OffsetDateTime.class)))
                .thenReturn(new HundredWargamingSubmissionResult(
                        9L, "CURRENT", "AUTO_APPROVED", 3900, 100));

        final HundredWargamingSubmissionResult result = service.create(
                USER, new HundredWargamingSubmissionRequest(VEHICLE, 1_234, 7));

        assertThat(result.decision()).isEqualTo("AUTO_APPROVED");
        verify(userProfileService).syncFromLogin(USER);
        verify(submissionService).validateWargamingPreflight(USER, VEHICLE);
        verify(gateway).fetch(WargamingServer.ASIA, ACCOUNT, VEHICLE);
    }

    @Test
    void firstTrustedLoginSyncsMissingProfileBeforeSubmitting() {
        login(true, "ASIA", ACCOUNT, "PlayerOne");
        final AtomicReference<Optional<UserProfile>> profileState = new AtomicReference<>(Optional.empty());
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenAnswer(invocation -> profileState.get());
        doAnswer(invocation -> {
            profileState.set(Optional.of(profile()));
            return null;
        }).when(userProfileService).syncFromLogin(USER);
        final WargamingOfficialStats official = stats(5_000, 100, 390_000);
        when(gateway.fetch(WargamingServer.ASIA, ACCOUNT, VEHICLE)).thenReturn(official);
        when(submissionService.createWargamingSubmission(
                eq(USER), eq(3900), eq(100), eq(official), any(OffsetDateTime.class)))
                .thenReturn(new HundredWargamingSubmissionResult(
                        9L, "CURRENT", "AUTO_APPROVED", 3900, 100));

        final HundredWargamingSubmissionResult result = service.create(
                USER, new HundredWargamingSubmissionRequest(VEHICLE, 3900, 100));

        assertThat(result.decision()).isEqualTo("AUTO_APPROVED");
        verify(userProfileService).syncFromLogin(USER);
        verify(gateway).fetch(WargamingServer.ASIA, ACCOUNT, VEHICLE);
        verify(submissionService).createWargamingSubmission(
                eq(USER), eq(3900), eq(100), eq(official), any(OffsetDateTime.class));
    }

    @Test
    void untrustedJwtAndManualProfileAreRejectedBeforeGateway() {
        login(false, "ASIA", ACCOUNT, "PlayerOne");
        assertThatThrownBy(() -> service.create(
                USER, new HundredWargamingSubmissionRequest(VEHICLE, 3900, 100)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_WARGAMING_IDENTITY_REQUIRED");
        verify(userProfileService, never()).syncFromLogin(USER);
        verify(gateway, never()).fetch(any(), anyLong(), anyLong());

        login(true, "ASIA", ACCOUNT, "PlayerOne");
        final UserProfile manual = profile();
        manual.setWotbAccountSource("MANUAL");
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(manual));
        assertThatThrownBy(() -> service.create(
                USER, new HundredWargamingSubmissionRequest(VEHICLE, 3900, 100)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_WARGAMING_IDENTITY_MISMATCH");
        verify(submissionService, never()).createWargamingSubmission(
                anyString(), anyInt(), anyInt(), any(), any());
    }

    @Test
    void profileSyncFailureNeverQueriesWargamingOrCreatesSubmission() {
        login(true, "ASIA", ACCOUNT, "PlayerOne");
        doAnswer(invocation -> {
            throw new IllegalArgumentException("PROFILE_REGION_MISMATCH");
        }).when(userProfileService).syncFromLogin(USER);

        assertThatThrownBy(() -> service.create(
                USER, new HundredWargamingSubmissionRequest(VEHICLE, 3900, 100)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("PROFILE_REGION_MISMATCH");

        verify(userProfileService, never()).findEntityByKeycloakUserId(USER);
        verify(gateway, never()).fetch(any(), anyLong(), anyLong());
        verify(submissionService, never()).validateWargamingPreflight(anyString(), anyLong());
        verify(submissionService, never()).createWargamingSubmission(
                anyString(), anyInt(), anyInt(), any(), any());
    }

    @Test
    void officialIdentityMismatchNeverWrites() {
        login(true, "EU", ACCOUNT, "PlayerOne");
        final UserProfile profile = profile();
        profile.setWotbServer("EU");
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile));
        when(gateway.fetch(WargamingServer.EU, ACCOUNT, VEHICLE)).thenReturn(
                new WargamingOfficialStats("EU", ACCOUNT, "AnotherPlayer",
                        5_000, VEHICLE, 100, 390_000));

        assertThatThrownBy(() -> service.create(
                USER, new HundredWargamingSubmissionRequest(VEHICLE, 3900, 100)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_WARGAMING_IDENTITY_MISMATCH");
        verify(submissionService, never()).createWargamingSubmission(
                anyString(), anyInt(), anyInt(), any(), any());
    }

    @Test
    void gatewayFailurePropagatesStableCodeAndNeverStartsSubmissionWrite() {
        login(true, "ASIA", ACCOUNT, "PlayerOne");
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        when(gateway.fetch(WargamingServer.ASIA, ACCOUNT, VEHICLE)).thenThrow(
                new ResponseStatusException(
                        HttpStatus.SERVICE_UNAVAILABLE, "HUNDRED_WARGAMING_UNAVAILABLE"));

        assertThatThrownBy(() -> service.create(
                USER, new HundredWargamingSubmissionRequest(VEHICLE, 3900, 100)))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> assertThat(((ResponseStatusException) error).getReason())
                        .isEqualTo("HUNDRED_WARGAMING_UNAVAILABLE"));
        verify(submissionService, never()).createWargamingSubmission(
                anyString(), anyInt(), anyInt(), any(), any());
    }

    @Test
    void inconsistentOfficialTotalsAreBadGatewayAndNeverWrite() {
        login(true, "ASIA", ACCOUNT, "PlayerOne");
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        when(gateway.fetch(WargamingServer.ASIA, ACCOUNT, VEHICLE)).thenReturn(
                new WargamingOfficialStats(
                        "ASIA", ACCOUNT, "PlayerOne", 5_000, VEHICLE, 5_001, 19_500_000));

        assertThatThrownBy(() -> service.create(
                USER, new HundredWargamingSubmissionRequest(VEHICLE, 3900, 100)))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> {
                    final ResponseStatusException response = (ResponseStatusException) error;
                    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_GATEWAY);
                    assertThat(response.getReason()).isEqualTo("HUNDRED_WARGAMING_INVALID_RESPONSE");
                });
        verify(submissionService, never()).createWargamingSubmission(
                anyString(), anyInt(), anyInt(), any(), any());
    }

    @Test
    void accountAndTankBattleThresholdsAreExact() {
        login(true, "NA", ACCOUNT, "PlayerOne");
        final UserProfile profile = profile();
        profile.setWotbServer("NA");
        when(userProfileService.findEntityByKeycloakUserId(USER)).thenReturn(Optional.of(profile));

        when(gateway.fetch(WargamingServer.NA, ACCOUNT, VEHICLE))
                .thenReturn(stats("NA", 4_999, 100, 390_000));
        assertThatThrownBy(() -> service.create(
                USER, new HundredWargamingSubmissionRequest(VEHICLE, 3900, 100)))
                .hasMessage("HUNDRED_WARGAMING_ACCOUNT_BATTLES_TOO_LOW");

        when(gateway.fetch(WargamingServer.NA, ACCOUNT, VEHICLE))
                .thenReturn(stats("NA", 5_000, 99, 386_100));
        assertThatThrownBy(() -> service.create(
                USER, new HundredWargamingSubmissionRequest(VEHICLE, 3900, 100)))
                .hasMessage("HUNDRED_WARGAMING_TANK_BATTLES_TOO_LOW");

        final WargamingOfficialStats boundary = stats("NA", 5_000, 100, 390_000);
        when(gateway.fetch(WargamingServer.NA, ACCOUNT, VEHICLE)).thenReturn(boundary);
        when(submissionService.createWargamingSubmission(
                eq(USER), eq(3900), eq(100), eq(boundary), any()))
                .thenReturn(new HundredWargamingSubmissionResult(
                        1L, "CURRENT", "AUTO_APPROVED", 3900, 100));
        assertThat(service.create(USER,
                new HundredWargamingSubmissionRequest(VEHICLE, 3900, 100)).status())
                .isEqualTo("CURRENT");
    }

    private static UserProfile profile() {
        final UserProfile profile = new UserProfile();
        profile.setKeycloakUserId(USER);
        profile.setWotbAccountSource("WARGAMING");
        profile.setWotbServer("ASIA");
        profile.setWotbAccountId(ACCOUNT);
        profile.setWotbNickname("PlayerOne");
        profile.setWotbAccountVerifiedAt(OffsetDateTime.parse("2026-08-01T00:00:00Z"));
        return profile;
    }

    private static WargamingOfficialStats stats(final long accountBattles,
                                                final long tankBattles,
                                                final long damage) {
        return stats("ASIA", accountBattles, tankBattles, damage);
    }

    private static WargamingOfficialStats stats(final String server,
                                                final long accountBattles,
                                                final long tankBattles,
                                                final long damage) {
        return new WargamingOfficialStats(
                server, ACCOUNT, "PlayerOne", accountBattles, VEHICLE, tankBattles, damage);
    }

    private static void login(final boolean verified,
                              final String region,
                              final long accountId,
                              final String nickname) {
        final Jwt jwt = Jwt.withTokenValue("t").header("alg", "none").subject(USER)
                .claims(claims -> claims.putAll(Map.of(
                        "wotb_verified", verified,
                        "wotb_region", region,
                        "wotb_account_id", Long.toString(accountId),
                        "wotb_nickname", nickname)))
                .build();
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(jwt, null));
    }
}

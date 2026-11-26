package com.wotb.web.mark3.service;

import com.wotb.web.mark3.entity.Mark3Submission;
import com.wotb.web.user.api.UserProfiles;
import com.wotb.web.user.api.WotbAccountIdentity;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class Mark3ModerationAndOwnershipTest extends Mark3SubmissionTestSupport {

    @Test
    void cancelByOwnerMovesPendingToCancelledAndClearsEvidence() {
        final Mark3Submission pending = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(pending));
        when(userProfileService.currentWotbIdentity(USER)).thenReturn(Optional.of(identity()));

        final var result = service.cancelSubmission(USER, 10L);

        assertThat(result.status()).isEqualTo("CANCELLED");
        assertThat(pending.getCancelledAt()).isNotNull();
        assertThat(pending.getProofScreenshotFirst()).isNull();
        assertThat(pending.getProofScreenshotSecond()).isNull();
        verify(evidenceService).discardForSubmission(10L);
    }

    @Test
    void cancelForbiddenWhenCallerBoundToAnotherWotbAccount() {
        final Mark3Submission pending = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(pending));
        when(userProfileService.currentWotbIdentity("kc-other"))
                .thenReturn(Optional.of(new WotbAccountIdentity(WOTB_SERVER, GAME_ID + 1)));

        assertThatThrownBy(() -> service.cancelSubmission("kc-other", 10L))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> {
                    assertThat(((ResponseStatusException) error).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(((ResponseStatusException) error).getReason()).contains("MARK3_FORBIDDEN");
                });

        assertThat(pending.getStatus()).isEqualTo("PENDING");
        assertThat(pending.getProofScreenshotFirst()).isNotNull();
        verify(evidenceService, never()).discardForSubmission(anyLong());
    }

    @Test
    void cancelForbiddenWhenCallerBoundToSameAccountOnAnotherServer() {
        final Mark3Submission pending = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(pending));
        when(userProfileService.currentWotbIdentity("kc-eu"))
                .thenReturn(Optional.of(new WotbAccountIdentity(OTHER_SERVER, GAME_ID)));

        assertThatThrownBy(() -> service.cancelSubmission("kc-eu", 10L))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> {
                    assertThat(((ResponseStatusException) error).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(((ResponseStatusException) error).getReason()).contains("MARK3_FORBIDDEN");
                });

        assertThat(pending.getStatus()).isEqualTo("PENDING");
        assertThat(pending.getProofScreenshotFirst()).isNotNull();
        assertThat(pending.getProofScreenshotSecond()).isNotNull();
        assertThat(pending.getWotbServer()).isEqualTo(WOTB_SERVER);
        assertThat(pending.getWotbAccountId()).isEqualTo(GAME_ID);
        verify(evidenceService, never()).discardForSubmission(anyLong());
        verify(repository, never()).save(any());
    }

    @Test
    void cancelForbiddenWhenCallerHasNoBoundWotbAccount() {
        final Mark3Submission pending = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(pending));
        when(userProfileService.currentWotbIdentity("kc-unknown")).thenReturn(Optional.empty());
        when(userProfileService.currentWotbIdentity("kc-unbound")).thenReturn(Optional.empty());

        for (final String caller : List.of("kc-unknown", "kc-unbound")) {
            assertThatThrownBy(() -> service.cancelSubmission(caller, 10L))
                    .as("caller %s", caller)
                    .isInstanceOf(ResponseStatusException.class)
                    .satisfies(error -> {
                        assertThat(((ResponseStatusException) error).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
                        assertThat(((ResponseStatusException) error).getReason()).contains("MARK3_FORBIDDEN");
                    });
        }

        assertThat(pending.getStatus()).isEqualTo("PENDING");
        assertThat(pending.getProofScreenshotFirst()).isNotNull();
        verify(evidenceService, never()).discardForSubmission(anyLong());
    }

    @Test
    void userStatusReturnsEmptyListsWhenNoBoundWotbAccount() {
        when(userProfileService.currentWotbIdentity("kc-unknown")).thenReturn(Optional.empty());
        when(userProfileService.currentWotbIdentity("kc-unbound")).thenReturn(Optional.empty());

        for (final String caller : List.of("kc-unknown", "kc-unbound")) {
            final var status = service.userStatus(caller);
            assertThat(status.current()).as("caller %s", caller).isEmpty();
            assertThat(status.pending()).isEmpty();
            assertThat(status.rejected()).isEmpty();
        }

        verify(repository, never()).findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                anyString(), anyLong(), any());
    }

    @Test
    void userStatusQueriesByBoundWotbAccountId() {
        when(userProfileService.currentWotbIdentity(USER)).thenReturn(Optional.of(identity()));
        final Mark3Submission current = currentSubmission(123);
        final Mark3Submission pending = pendingSubmission();
        final Mark3Submission rejected = pendingSubmission();
        rejected.setStatus("REJECTED");
        when(repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                WOTB_SERVER, GAME_ID, List.of("CURRENT"))).thenReturn(List.of(current));
        when(repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                WOTB_SERVER, GAME_ID, List.of("PENDING"))).thenReturn(List.of(pending));
        when(repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                WOTB_SERVER, GAME_ID, List.of("REJECTED"))).thenReturn(List.of(rejected));

        final var status = service.userStatus(USER);

        assertThat(status.current()).extracting("status").containsExactly("CURRENT");
        assertThat(status.pending()).extracting("status").containsExactly("PENDING");
        assertThat(status.rejected()).extracting("status").containsExactly("REJECTED");
    }

    @Test
    void userStatusQueriesByBoundServerNotOnlyByAccountId() {
        final Mark3Submission euCurrent = currentSubmission(123);
        euCurrent.setWotbServer(OTHER_SERVER);
        when(userProfileService.currentWotbIdentity(USER))
                .thenReturn(Optional.of(new WotbAccountIdentity(OTHER_SERVER, GAME_ID)));
        when(repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                OTHER_SERVER, GAME_ID, List.of("CURRENT"))).thenReturn(List.of(euCurrent));
        when(repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                OTHER_SERVER, GAME_ID, List.of("PENDING"))).thenReturn(List.of());
        when(repository.findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                OTHER_SERVER, GAME_ID, List.of("REJECTED"))).thenReturn(List.of());

        final var status = service.userStatus(USER);

        assertThat(status.current()).extracting("status").containsExactly("CURRENT");
        assertThat(status.pending()).isEmpty();
        assertThat(status.rejected()).isEmpty();
        verify(repository, never()).findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                eq(WOTB_SERVER), anyLong(), any());
    }
}

package com.wotb.web.hundred.service;

import com.wotb.web.hundred.dto.HundredSubmissionSummaryDto;
import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.user.api.UserProfiles;
import com.wotb.web.user.api.WotbAccountIdentity;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class HundredSubmissionLifecycleTest extends HundredSubmissionTestSupport {

    @Test
    void allowsDifferentVehicleWhenAnotherPendingExists() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        org.mockito.Mockito.lenient()
                .when(repository.existsByWotbServerAndWotbAccountIdAndVehicleIdAndStatus(
                        WOTB_SERVER, GAME_ID, TIER10_VEHICLE, "PENDING"))
                .thenReturn(true);

        service.createSubmission(USER, TIER10_VEHICLE_2, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays(), arena -> battle(arena, GAME_ID, TIER10_VEHICLE_2)));
        verify(repository).saveAndFlush(any());
    }

    @Test
    void createScopesUniquenessAndCurrentLookupsToTheBoundServer() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays()));

        verify(repository, org.mockito.Mockito.times(2)).existsByWotbServerAndWotbAccountIdAndVehicleIdAndStatus(
                WOTB_SERVER, GAME_ID, TIER10_VEHICLE, "PENDING");
        verify(repository).findByWotbServerAndWotbAccountIdAndVehicleIdAndStatus(
                WOTB_SERVER, GAME_ID, TIER10_VEHICLE, "CURRENT");
    }

    @Test
    void mapsPendingUniqueIndexRaceToConflict() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        when(repository.saveAndFlush(any()))
                .thenThrow(new DataIntegrityViolationException("uk_hundred_battle_pending_user_vehicle"));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_PENDING_EXISTS");
        verify(evidenceService).storeAll(anyList());
        verify(evidenceService).cleanupStoredFiles(anyList());
        verify(evidenceService, never()).attach(anyLong(), anyList());
    }

    @Test
    void currentGateAllowsStrictlyHigherScore() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        when(repository.findByWotbServerAndWotbAccountIdAndVehicleIdAndStatus(
                WOTB_SERVER, GAME_ID, TIER10_VEHICLE, "CURRENT"))
                .thenReturn(Optional.of(currentSubmission(4000)));

        service.createSubmission(USER, TIER10_VEHICLE, 4001, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays()));
        verify(repository).saveAndFlush(any());
    }

    @Test
    void currentGateRejectsEqualScore() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        when(repository.findByWotbServerAndWotbAccountIdAndVehicleIdAndStatus(
                WOTB_SERVER, GAME_ID, TIER10_VEHICLE, "CURRENT"))
                .thenReturn(Optional.of(currentSubmission(4000)));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 4000, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_NOT_HIGHER");
        verify(repository, never()).saveAndFlush(any());
    }

    @Test
    void currentGateRejectsLowerScore() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        when(repository.findByWotbServerAndWotbAccountIdAndVehicleIdAndStatus(
                WOTB_SERVER, GAME_ID, TIER10_VEHICLE, "CURRENT"))
                .thenReturn(Optional.of(currentSubmission(4000)));

        assertThatThrownBy(() -> service.createSubmission(USER, TIER10_VEHICLE, 3999, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_NOT_HIGHER");
    }

    @Test
    void noCurrentWithHistoricalDeletedOrSupersededAllowsRestart() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));

        service.createSubmission(USER, TIER10_VEHICLE, 4000, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays()));
        verify(repository).saveAndFlush(any());
    }


    @Test
    void approveWithoutCurrentMakesSubmissionCurrent() {
        final HundredBattleSubmission s = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        final HundredSubmissionSummaryDto result =
                moderationService.approve(ADMIN, 10L);

        assertThat(result.status()).isEqualTo("CURRENT");
        assertThat(s.getApprovedAverageDamage()).isEqualTo(4200);
        assertThat(s.getApprovedBattleCount()).isEqualTo(136);
        assertThat(s.getApprovedAt()).isNotNull();
        assertThat(s.getApprovedBy()).isEqualTo(ADMIN);
        assertThat(s.getProofScreenshot()).isNull();
        verify(evidenceService).discardForSubmission(10L);
        verify(repository).saveAndFlush(s);
    }

    @Test
    void approveWithExistingLowerCurrentSupersedesIt() {
        final HundredBattleSubmission s = pendingSubmission();
        final HundredBattleSubmission current = currentSubmission(4100);
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));
        when(repository.findCurrentForUpdate(WOTB_SERVER, GAME_ID, TIER10_VEHICLE))
                .thenReturn(Optional.of(current));

        final HundredSubmissionSummaryDto result = moderationService.approve(ADMIN, 10L);

        assertThat(result.status()).isEqualTo("CURRENT");
        assertThat(current.getStatus()).isEqualTo("SUPERSEDED");
        assertThat(s.getStatus()).isEqualTo("CURRENT");
        verify(repository).saveAndFlush(current);
        verify(repository).saveAndFlush(s);
        verify(evidenceService).discardForSubmission(10L);
    }

    @Test
    void approveRejectsWhenFrozenSubmissionValueNotHigherThanCurrent() {
        final HundredBattleSubmission s = pendingSubmission();
        final HundredBattleSubmission current = currentSubmission(4200);
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));
        when(repository.findCurrentForUpdate(WOTB_SERVER, GAME_ID, TIER10_VEHICLE))
                .thenReturn(Optional.of(current));

        assertThatThrownBy(() -> moderationService.approve(ADMIN, 10L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_APPROVE_STALE");
        assertThat(current.getStatus()).isEqualTo("CURRENT");
        assertThat(s.getStatus()).isEqualTo("PENDING");
    }

    @Test
    void approveRejectsIncompleteEvidenceWithoutSupersedingCurrent() {
        final HundredBattleSubmission s = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));
        org.mockito.Mockito.doThrow(new IllegalStateException("HUNDRED_INCOMPLETE_REVIEW_EVIDENCE"))
                .when(evidenceService).requireCompleteEvidenceForApproval(anyLong(), any());

        assertThatThrownBy(() -> moderationService.approve(ADMIN, 10L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_INCOMPLETE_REVIEW_EVIDENCE");

        verify(repository, never()).findCurrentForUpdate(anyString(), anyLong(), anyLong());
        assertThat(s.getStatus()).isEqualTo("PENDING");
    }

    @Test
    void approveRejectsWhenCurrentRoseAfterSubmission() {
        final HundredBattleSubmission s = pendingSubmission();
        final HundredBattleSubmission current = currentSubmission(4300);
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));
        when(repository.findCurrentForUpdate(WOTB_SERVER, GAME_ID, TIER10_VEHICLE))
                .thenReturn(Optional.of(current));

        assertThatThrownBy(() -> moderationService.approve(ADMIN, 10L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_APPROVE_STALE");
    }

    @Test
    void approveRejectsInvalidApprovedValues() {
        final HundredBattleSubmission s = pendingSubmission();
        s.setClaimedAverageDamage(0);
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        assertThatThrownBy(() -> moderationService.approve(ADMIN, 10L))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_INVALID_APPROVED");
    }

    @Test
    void approveRejectsBattleCountBelowOneHundred() {
        final HundredBattleSubmission s = pendingSubmission();
        s.setClaimedBattleCount(99);
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        assertThatThrownBy(() -> moderationService.approve(ADMIN, 10L))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_APPROVED_BATTLE_COUNT_TOO_LOW");
        verify(repository, never()).saveAndFlush(any());
        verify(repository, never()).save(any());
    }

    @Test
    void approveAllowsBattleCountExactlyOneHundred() {
        final HundredBattleSubmission s = pendingSubmission();
        s.setClaimedBattleCount(100);
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        final HundredSubmissionSummaryDto result = moderationService.approve(ADMIN, 10L);

        assertThat(result.status()).isEqualTo("CURRENT");
        assertThat(s.getApprovedBattleCount()).isEqualTo(100);
        assertThat(s.getApprovedAverageDamage()).isEqualTo(4200);
    }

    @Test
    void approveRejectsWhenSubmissionNotPending() {
        final HundredBattleSubmission s = pendingSubmission();
        s.setStatus("CANCELLED");
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        assertThatThrownBy(() -> moderationService.approve(ADMIN, 10L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_SUBMISSION_NOT_PENDING");
    }


    @Test
    void rejectSetsReasonAndClearsEvidence() {
        final HundredBattleSubmission s = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        final HundredSubmissionSummaryDto result =
                moderationService.reject(ADMIN, 10L, "SCREENSHOT_MISMATCH", null);

        assertThat(result.status()).isEqualTo("REJECTED");
        assertThat(s.getRejectedBy()).isEqualTo(ADMIN);
        assertThat(s.getRejectReason()).isEqualTo("SCREENSHOT_MISMATCH");
        assertThat(s.getRejectReasonText()).isNull();
        assertThat(s.getProofScreenshot()).isNull();
        verify(evidenceService).discardForSubmission(10L);
    }

    @Test
    void rejectRequiresReason() {
        assertThatThrownBy(() -> moderationService.reject(ADMIN, 10L, "  ", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_REJECT_REASON_REQUIRED");
        assertThatThrownBy(() -> moderationService.reject(ADMIN, 10L, "UNKNOWN_CATEGORY", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_REJECT_REASON_REQUIRED");
    }

    @Test
    void rejectOtherRequiresText() {
        assertThatThrownBy(() -> moderationService.reject(ADMIN, 10L, "OTHER", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_REJECT_REASON_TEXT_REQUIRED");
    }

    @Test
    void rejectCannotTransitionNonPending() {
        final HundredBattleSubmission s = pendingSubmission();
        s.setStatus("CURRENT");
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        assertThatThrownBy(() -> moderationService.reject(ADMIN, 10L, "SCREENSHOT_MISMATCH", null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_SUBMISSION_NOT_PENDING");
    }

    @Test
    void cancelByOwnerMovesPendingToCancelledAndClearsEvidence() {
        final HundredBattleSubmission s = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));
        when(userProfileService.currentWotbIdentity(USER)).thenReturn(Optional.of(identity()));

        final HundredSubmissionSummaryDto result = service.cancelSubmission(USER, 10L);

        assertThat(result.status()).isEqualTo("CANCELLED");
        assertThat(s.getCancelledAt()).isNotNull();
        assertThat(s.getProofScreenshot()).isNull();
        verify(evidenceService).discardForSubmission(10L);
    }

    @Test
    void cancelForbiddenWhenCallerBoundToAnotherWotbAccount() {
        final HundredBattleSubmission s = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));
        when(userProfileService.currentWotbIdentity("kc-other"))
                .thenReturn(Optional.of(new WotbAccountIdentity(WOTB_SERVER, GAME_ID + 1)));

        assertThatThrownBy(() -> service.cancelSubmission("kc-other", 10L))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(e -> {
                    assertThat(((ResponseStatusException) e).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(((ResponseStatusException) e).getReason()).contains("HUNDRED_FORBIDDEN");
                });

        assertThat(s.getStatus()).isEqualTo("PENDING");
        assertThat(s.getProofScreenshot()).isNotNull();
        verify(evidenceService, never()).discardForSubmission(anyLong());
    }

    @Test
    void cancelForbiddenWhenCallerBoundToSameAccountOnAnotherServer() {
        final HundredBattleSubmission s = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));
        when(userProfileService.currentWotbIdentity("kc-eu"))
                .thenReturn(Optional.of(new WotbAccountIdentity(OTHER_SERVER, GAME_ID)));

        assertThatThrownBy(() -> service.cancelSubmission("kc-eu", 10L))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(e -> {
                    assertThat(((ResponseStatusException) e).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(((ResponseStatusException) e).getReason()).contains("HUNDRED_FORBIDDEN");
                });

        assertThat(s.getStatus()).isEqualTo("PENDING");
        assertThat(s.getProofScreenshot()).isNotNull();
        assertThat(s.getWotbServer()).isEqualTo(WOTB_SERVER);
        assertThat(s.getWotbAccountId()).isEqualTo(GAME_ID);
        verify(evidenceService, never()).discardForSubmission(anyLong());
        verify(repository, never()).save(any());
    }

    @Test
    void cancelForbiddenWhenCallerHasNoBoundWotbAccount() {
        final HundredBattleSubmission s = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));
        when(userProfileService.currentWotbIdentity("kc-unknown")).thenReturn(Optional.empty());
        when(userProfileService.currentWotbIdentity("kc-unbound")).thenReturn(Optional.empty());

        for (final String caller : List.of("kc-unknown", "kc-unbound")) {
            assertThatThrownBy(() -> service.cancelSubmission(caller, 10L))
                    .as("caller %s", caller)
                    .isInstanceOf(ResponseStatusException.class)
                    .satisfies(e -> {
                        assertThat(((ResponseStatusException) e).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
                        assertThat(((ResponseStatusException) e).getReason()).contains("HUNDRED_FORBIDDEN");
                    });
        }

        assertThat(s.getStatus()).isEqualTo("PENDING");
        assertThat(s.getProofScreenshot()).isNotNull();
        verify(evidenceService, never()).discardForSubmission(anyLong());
    }

    @Test
    void cancelCannotTransitionAlreadyApproved() {
        final HundredBattleSubmission s = currentSubmission(4100);
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));
        when(userProfileService.currentWotbIdentity(USER)).thenReturn(Optional.of(identity()));

        assertThatThrownBy(() -> service.cancelSubmission(USER, 10L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_SUBMISSION_NOT_PENDING");
    }

    @Test
    void deleteIsStatusIndependentAndPhysicallyRemovesEveryState() {
        for (final String status : List.of("PENDING", "CURRENT", "SUPERSEDED", "REJECTED", "CANCELLED", "DELETED")) {
            final HundredBattleSubmission s = currentSubmission(4120);
            s.setStatus(status);
            s.setProofScreenshot("data:image/png;base64,AAAA");
            when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

            final HundredSubmissionSummaryDto result =
                    moderationService.deleteSubmission(ADMIN, "admin-user", 10L, "CHEATING_FORGERY", "  spam  ");

            // 响应为删除前快照
            assertThat(result.status()).as("pre-delete status of %s", status).isEqualTo(status);
            // 审计快照记录删除前原始状态与原因，同一事务落库
            final var audit = org.mockito.ArgumentCaptor.forClass(
                    com.wotb.web.hundred.entity.HundredAdminLog.class);
            verify(auditRepository).save(audit.capture());
            final com.wotb.web.hundred.entity.HundredAdminLog log = audit.getValue();
            assertThat(log.getOriginalStatus()).as("audit status of %s", status).isEqualTo(status);
            assertThat(log.getSubmissionId()).isEqualTo(10L);
            assertThat(log.getWotbServer()).isEqualTo(WOTB_SERVER);
            assertThat(log.getWotbAccountId()).isEqualTo(GAME_ID);
            assertThat(log.getVehicleId()).isEqualTo(TIER10_VEHICLE);
            assertThat(log.getVehicleName()).isEqualTo("Progetto 65");
            assertThat(log.getNicknameSnapshot()).isEqualTo("PlayerOne");
            assertThat(log.getClaimedAverageDamage()).isEqualTo(4200);
            assertThat(log.getApprovedAverageDamage()).isEqualTo(4120);
            assertThat(log.isHadProofScreenshot()).isTrue();
            assertThat(log.getAdminKeycloakUserId()).isEqualTo(ADMIN);
            assertThat(log.getAdminUsername()).isEqualTo("admin-user");
            assertThat(log.getDeleteReason()).isEqualTo("CHEATING_FORGERY");
            assertThat(log.getDeleteReasonText()).isEqualTo("spam");
            // 回放证据清理与物理删除（FK RESTRICT：先删证据行）
            verify(evidenceService).discardForSubmission(10L);
            verify(repository).delete(s);
            verify(repository).flush();
            org.mockito.Mockito.clearInvocations(auditRepository, repository, evidenceService);
        }
    }

    @Test
    void deleteRequiresReason() {
        assertThatThrownBy(() -> moderationService.deleteSubmission(ADMIN, null, 10L, null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_DELETE_REASON_REQUIRED");
        assertThatThrownBy(() -> moderationService.deleteSubmission(ADMIN, null, 10L, "OTHER", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_DELETE_REASON_TEXT_REQUIRED");
        verify(repository, never()).delete(any(HundredBattleSubmission.class));
        verify(auditRepository, never()).save(any());
    }

    @Test
    void deleteMissingSubmissionReturnsNotFound() {
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> moderationService.deleteSubmission(ADMIN, null, 10L, "CHEATING_FORGERY", null))
                .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        verify(auditRepository, never()).save(any());
        verify(evidenceService, never()).discardForSubmission(anyLong());
    }

    @Test
    void deleteDoesNotTouchSupersededHistory() {
        final HundredBattleSubmission s = currentSubmission(4120);
        final HundredBattleSubmission superseded = currentSubmission(3900);
        superseded.setStatus("SUPERSEDED");
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        moderationService.deleteSubmission(ADMIN, null, 10L, "CHEATING_FORGERY", null);

        // 删 CURRENT 不复活/不改写其它记录（含 SUPERSEDED）
        verify(repository, never()).save(superseded);
        verify(repository, never()).delete(superseded);
        assertThat(superseded.getStatus()).isEqualTo("SUPERSEDED");
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
}

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

/**
 * 百场 submission 业务契约测试（Mockito，无 DB，任何环境可跑）。
 * 覆盖：submission 校验矩阵 / CURRENT 门槛 / snapshot /
 * approval / terminal transition 竞争 / delete / rank / files。
 */
@ExtendWith(MockitoExtension.class)
class HundredSubmissionLifecycleTest extends HundredSubmissionTestSupport {

    @Test
    void allowsDifferentVehicleWhenAnotherPendingExists() throws Exception {
        when(userProfileService.findSnapshotByKeycloakUserId(USER)).thenReturn(Optional.of(profile()));
        // IS-7 (385) 已有 PENDING（本次提交的是另一辆车，该 stub 只表达「另一辆车已有 PENDING」的场景前提）
        org.mockito.Mockito.lenient()
                .when(repository.existsByWotbServerAndWotbAccountIdAndVehicleIdAndStatus(
                        WOTB_SERVER, GAME_ID, TIER10_VEHICLE, "PENDING"))
                .thenReturn(true);

        // IS-7 (385) 已有 PENDING，提交另一辆 Tier X (3649) 允许
        service.createSubmission(USER, TIER10_VEHICLE_2, 4200, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays(), arena -> battle(arena, GAME_ID, TIER10_VEHICLE_2)));
        verify(repository).saveAndFlush(any());
    }

    @Test
    void createScopesUniquenessAndCurrentLookupsToTheBoundServer() throws Exception {
        // 归属维度含区服：同一个 WotB 账号 ID 在 CN / EU 是两个账号，
        // 因此 create 的 PENDING 预检与 CURRENT 门槛都必须带上 profile 的区服。
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
        // 锁内失败 → rollback 后引用计数保护清理（不允许留下无 DB 引用的孤儿文件常态）
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

        // CURRENT 不存在（历史 DELETED/SUPERSEDED 由 repository 查询自然排除）
        service.createSubmission(USER, TIER10_VEHICLE, 4000, 136,
                "data:image/png;base64,AAAA", fiveReplays(), facts(fiveReplays()));
        verify(repository).saveAndFlush(any());
    }

    // ── Approval ─────────────────────────────────────────────────────────

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
        // 无旧 CURRENT：仅保存 submission（saveAndFlush 保证提交）
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

        // MANUAL 的创建时申报场均=4200，与 CURRENT 相同，管理员不能改分绕过严格递增。
        assertThatThrownBy(() -> moderationService.approve(ADMIN, 10L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_APPROVE_STALE");
        assertThat(current.getStatus()).isEqualTo("CURRENT");
        assertThat(s.getStatus()).isEqualTo("PENDING");
    }

    @Test
    void approveRejectsIncompleteEvidenceWithoutSupersedingCurrent() {
        // Blocker：evidence 校验失败必须在任何业务状态改变（旧 CURRENT → SUPERSEDED）之前发生。
        // 不 stub findCurrentForUpdate：校验失败短路于任何 CURRENT 读取/变更之前。
        final HundredBattleSubmission s = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));
        org.mockito.Mockito.doThrow(new IllegalStateException("HUNDRED_INCOMPLETE_REVIEW_EVIDENCE"))
                .when(evidenceService).requireCompleteEvidenceForApproval(anyLong(), any());

        assertThatThrownBy(() -> moderationService.approve(ADMIN, 10L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_INCOMPLETE_REVIEW_EVIDENCE");

        // 未触碰 CURRENT 读取/变更：无 supersede，PENDING 与证据保持
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

        // 百场资格：冻结 battleCount < 100 必须拒绝（backend authoritative）。
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

        // 竞争：CANCEL 已成功 → APPROVE 得到明确 conflict
        assertThatThrownBy(() -> moderationService.approve(ADMIN, 10L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_SUBMISSION_NOT_PENDING");
    }

    // ── REJECT / CANCEL / DELETE ─────────────────────────────────────────

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
        // ownership 按当前绑定的 canonical 身份判定：userId 只用于解析身份，比较的是 (区服, 账号) 二元组
        when(userProfileService.currentWotbIdentity(USER)).thenReturn(Optional.of(identity()));

        final HundredSubmissionSummaryDto result = service.cancelSubmission(USER, 10L);

        assertThat(result.status()).isEqualTo("CANCELLED");
        assertThat(s.getCancelledAt()).isNotNull();
        assertThat(s.getProofScreenshot()).isNull();
        verify(evidenceService).discardForSubmission(10L);
    }

    @Test
    void cancelForbiddenWhenCallerBoundToAnotherWotbAccount() {
        final HundredBattleSubmission s = pendingSubmission(); // owner = (WOTB_SERVER, GAME_ID)
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));
        // 同一 Keycloak 用户改绑到另一个 WotB 账号（同区服）→ 记录仍属原账号，不可取消
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
        // 区服是 canonical owner 的一部分：(CN, 111) 与 (EU, 111) 是两个不同账号。
        // 只比账号 ID 会让跨服同号互相取消对方的申请。
        final HundredBattleSubmission s = pendingSubmission(); // owner = (CN, GAME_ID)
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));
        when(userProfileService.currentWotbIdentity("kc-eu"))
                .thenReturn(Optional.of(new WotbAccountIdentity(OTHER_SERVER, GAME_ID)));

        assertThatThrownBy(() -> service.cancelSubmission("kc-eu", 10L))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(e -> {
                    assertThat(((ResponseStatusException) e).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
                    assertThat(((ResponseStatusException) e).getReason()).contains("HUNDRED_FORBIDDEN");
                });

        // 记录状态与证据必须原封不动
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
        // 未绑定账号的两种形态都必须是 403：profile 不存在，或 profile 存在但 wotbAccountId 为 null
        // （后者由 UserProfiles.currentWotbIdentity 统一归一为 empty，服务层不需要第二套规则）
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
    void deleteCurrentMovesToDeletedWithReason() {
        final HundredBattleSubmission s = currentSubmission(4120);
        s.setProofScreenshot("data:image/png;base64,AAAA");
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        final HundredSubmissionSummaryDto result =
                moderationService.deleteCurrent(ADMIN, 10L, "CHEATING_FORGERY", null);

        assertThat(result.status()).isEqualTo("DELETED");
        assertThat(s.getDeletedBy()).isEqualTo(ADMIN);
        assertThat(s.getDeleteReason()).isEqualTo("CHEATING_FORGERY");
        assertThat(s.getDeletedAt()).isNotNull();
        assertThat(s.getProofScreenshot()).isNull();
        verify(evidenceService).discardForSubmission(10L);
    }

    @Test
    void deleteRequiresReason() {
        assertThatThrownBy(() -> moderationService.deleteCurrent(ADMIN, 10L, null, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_DELETE_REASON_REQUIRED");
        assertThatThrownBy(() -> moderationService.deleteCurrent(ADMIN, 10L, "OTHER", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("HUNDRED_DELETE_REASON_TEXT_REQUIRED");
    }

    @Test
    void deleteOnlyFromCurrent() {
        final HundredBattleSubmission s = pendingSubmission();
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        assertThatThrownBy(() -> moderationService.deleteCurrent(ADMIN, 10L, "CHEATING_FORGERY", null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("HUNDRED_NOT_CURRENT");
    }

    @Test
    void deleteCurrentDoesNotTouchSupersededHistory() {
        final HundredBattleSubmission s = currentSubmission(4120);
        final HundredBattleSubmission superseded = currentSubmission(3900);
        superseded.setStatus("SUPERSEDED");
        when(repository.findByIdForUpdate(10L)).thenReturn(Optional.of(s));

        moderationService.deleteCurrent(ADMIN, 10L, "CHEATING_FORGERY", null);

        // 只保存被删除的 CURRENT 行；SUPERSEDED 历史保持原状（不恢复）
        verify(repository).save(s);
        verify(repository, never()).save(superseded);
        assertThat(superseded.getStatus()).isEqualTo("SUPERSEDED");
    }

    // ── Profile：userStatus（ownership = 当前绑定的 WotB 账号） ────────────

    @Test
    void userStatusReturnsEmptyListsWhenNoBoundWotbAccount() {
        // profile 不存在或未绑定账号 → 三个空列表；不再抛错，也不回退到 Keycloak id 查询
        when(userProfileService.currentWotbIdentity("kc-unknown")).thenReturn(Optional.empty());
        when(userProfileService.currentWotbIdentity("kc-unbound")).thenReturn(Optional.empty());

        for (final String caller : List.of("kc-unknown", "kc-unbound")) {
            final var status = service.userStatus(caller);
            assertThat(status.current()).as("caller %s", caller).isEmpty();
            assertThat(status.pending()).isEmpty();
            assertThat(status.rejected()).isEmpty();
        }

        // 未绑定 → 从不查 repository（不得按 Keycloak 身份兜底）
        verify(repository, never()).findByWotbServerAndWotbAccountIdAndStatusInOrderBySubmittedAtDesc(
                anyString(), anyLong(), any());
    }
}

package com.wotb.web.hundred.service;

import com.wotb.web.hundred.dto.BulkDeleteItemResult;
import com.wotb.web.hundred.dto.BulkDeleteResultDto;
import com.wotb.web.hundred.dto.HundredSubmissionSummaryDto;
import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.hundred.enums.HundredBattleStatus;
import com.wotb.web.hundred.repository.HundredBattleSubmissionRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;

/** 百场管理员审核与终态迁移。创建、取消与回放锁生命周期仍由 submission service 持有。 */
@Service
public class HundredModerationService {
    private final HundredBattleSubmissionRepository repository;
    private final HundredBattleMapper mapper;
    private final HundredReplayEvidenceService evidenceService;
    private final TransactionTemplate transactionTemplate;

    public HundredModerationService(
            final HundredBattleSubmissionRepository repository,
            final HundredBattleMapper mapper,
            final HundredReplayEvidenceService evidenceService,
            final PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.mapper = mapper;
        this.evidenceService = evidenceService;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    @Transactional
    public HundredSubmissionSummaryDto approve(final String adminUserId, final long submissionId) {
        final HundredBattleSubmission submission = repository.findByIdForUpdate(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "HUNDRED_SUBMISSION_NOT_FOUND"));
        HundredBattleSubmissionService.requirePending(submission);
        evidenceService.requireCompleteEvidenceForApproval(submission.getId(), submission.getProofScreenshot());
        final int approvedAverageDamage = submission.getClaimedAverageDamage();
        final int approvedBattleCount = submission.getClaimedBattleCount();
        HundredBattleSubmissionService.requireApprovedValues(approvedAverageDamage, approvedBattleCount);
        final HundredBattleSubmission saved = promoteToCurrent(
                submission, approvedAverageDamage, approvedBattleCount, adminUserId,
                OffsetDateTime.now(), "HUNDRED_APPROVE_STALE", true);
        final HundredSubmissionSummaryDto result = mapper.toSummary(saved);
        evidenceService.discardForSubmission(submission.getId());
        return result;
    }

    @Transactional
    public HundredSubmissionSummaryDto reject(
            final String adminUserId, final long submissionId,
            final String rejectReason, final String rejectReasonText) {
        final String reason = HundredBattleSubmissionService.requireCategory(
                rejectReason, "HUNDRED_REJECT_REASON_REQUIRED", HundredBattleSubmissionService.REJECT_CATEGORIES);
        if ("OTHER".equals(reason) && !StringUtils.hasText(rejectReasonText)) {
            throw new IllegalArgumentException("HUNDRED_REJECT_REASON_TEXT_REQUIRED");
        }
        final HundredBattleSubmission submission = repository.findByIdForUpdate(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "HUNDRED_SUBMISSION_NOT_FOUND"));
        HundredBattleSubmissionService.requirePending(submission);
        submission.setStatus(HundredBattleStatus.REJECTED.name());
        submission.setRejectedAt(OffsetDateTime.now());
        submission.setRejectedBy(adminUserId);
        submission.setRejectReason(reason);
        submission.setRejectReasonText(StringUtils.hasText(rejectReasonText) ? rejectReasonText.trim() : null);
        submission.setProofScreenshot(null);
        final HundredSubmissionSummaryDto result = mapper.toSummary(repository.save(submission));
        evidenceService.discardForSubmission(submission.getId());
        return result;
    }

    @Transactional
    public HundredSubmissionSummaryDto deleteCurrent(
            final String adminUserId, final long submissionId,
            final String deleteReason, final String deleteReasonText) {
        return deleteCurrentInternal(adminUserId, submissionId,
                requireDeleteReason(deleteReason, deleteReasonText), deleteReasonText);
    }

    /** 每条使用独立事务，保留 partial success 与终态证据清理语义。 */
    public BulkDeleteResultDto bulkDeleteCurrent(
            final String adminUserId, final List<Long> ids,
            final String deleteReason, final String deleteReasonText) {
        final String reason = requireDeleteReason(deleteReason, deleteReasonText);
        final List<BulkDeleteItemResult> results = new ArrayList<>(ids.size());
        int deleted = 0;
        for (final long id : ids) {
            try {
                transactionTemplate.executeWithoutResult(status ->
                        deleteCurrentInternal(adminUserId, id, reason, deleteReasonText));
                results.add(new BulkDeleteItemResult(id, true, null));
                deleted++;
            } catch (final ResponseStatusException e) {
                results.add(new BulkDeleteItemResult(id, false, e.getReason()));
            } catch (final IllegalStateException e) {
                results.add(new BulkDeleteItemResult(id, false, e.getMessage()));
            }
        }
        return new BulkDeleteResultDto(ids.size(), deleted, ids.size() - deleted, results);
    }

    private static String requireDeleteReason(final String value, final String text) {
        final String reason = HundredBattleSubmissionService.requireCategory(
                value, "HUNDRED_DELETE_REASON_REQUIRED", HundredBattleSubmissionService.DELETE_CATEGORIES);
        if ("OTHER".equals(reason) && !StringUtils.hasText(text)) {
            throw new IllegalArgumentException("HUNDRED_DELETE_REASON_TEXT_REQUIRED");
        }
        return reason;
    }

    private HundredSubmissionSummaryDto deleteCurrentInternal(
            final String adminUserId, final long submissionId, final String reason, final String deleteReasonText) {
        final HundredBattleSubmission submission = repository.findByIdForUpdate(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "HUNDRED_SUBMISSION_NOT_FOUND"));
        if (!"CURRENT".equals(submission.getStatus())) throw new IllegalStateException("HUNDRED_NOT_CURRENT");
        submission.setStatus(HundredBattleStatus.DELETED.name());
        submission.setDeletedAt(OffsetDateTime.now());
        submission.setDeletedBy(adminUserId);
        submission.setDeleteReason(reason);
        submission.setDeleteReasonText(StringUtils.hasText(deleteReasonText) ? deleteReasonText.trim() : null);
        submission.setProofScreenshot(null);
        final HundredSubmissionSummaryDto result = mapper.toSummary(repository.save(submission));
        evidenceService.discardForSubmission(submission.getId());
        return result;
    }

    /** Strictly lock/check CURRENT, flush SUPERSEDED first, then persist the approved submission. */
    private HundredBattleSubmission promoteToCurrent(
            final HundredBattleSubmission submission, final int approvedAverageDamage,
            final int approvedBattleCount, final String approvedBy, final OffsetDateTime approvedAt,
            final String staleError, final boolean clearProof) {
        final HundredBattleSubmission current = repository.findCurrentForUpdate(
                submission.getWotbServer(), submission.getWotbAccountId(), submission.getVehicleId()).orElse(null);
        if (current != null && current.getApprovedAverageDamage() != null
                && approvedAverageDamage <= current.getApprovedAverageDamage()) {
            throw new IllegalStateException(staleError);
        }
        if (current != null) {
            current.setStatus(HundredBattleStatus.SUPERSEDED.name());
            repository.saveAndFlush(current);
        }
        submission.setApprovedAverageDamage(approvedAverageDamage);
        submission.setApprovedBattleCount(approvedBattleCount);
        submission.setStatus(HundredBattleStatus.CURRENT.name());
        submission.setApprovedAt(approvedAt);
        submission.setApprovedBy(approvedBy);
        if (clearProof) submission.setProofScreenshot(null);
        return repository.saveAndFlush(submission);
    }
}

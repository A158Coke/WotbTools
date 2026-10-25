package com.wotb.web.mark3.service;

import com.wotb.web.mark3.dto.BulkDeleteItemResult;
import com.wotb.web.mark3.dto.BulkDeleteResultDto;
import com.wotb.web.mark3.dto.Mark3SubmissionSummaryDto;
import com.wotb.web.mark3.entity.Mark3Submission;
import com.wotb.web.mark3.enums.Mark3Status;
import com.wotb.web.mark3.repository.Mark3SubmissionRepository;
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

/** 三环管理员审核与终态迁移。创建、取消与回放锁生命周期仍由 submission service 持有。 */
@Service
public class Mark3ModerationService {
    private final Mark3SubmissionRepository repository;
    private final Mark3Mapper mapper;
    private final Mark3ReplayEvidenceService evidenceService;
    private final TransactionTemplate transactionTemplate;

    public Mark3ModerationService(
            final Mark3SubmissionRepository repository,
            final Mark3Mapper mapper,
            final Mark3ReplayEvidenceService evidenceService,
            final PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.mapper = mapper;
        this.evidenceService = evidenceService;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    /** 只将创建时冻结的 claimed 值写入 approved；CURRENT 已存在时拒绝替换。 */
    @Transactional
    public Mark3SubmissionSummaryDto approve(final String adminUserId, final long submissionId) {
        final Mark3Submission submission = repository.findByIdForUpdate(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "MARK3_SUBMISSION_NOT_FOUND"));
        Mark3SubmissionService.requirePending(submission);
        evidenceService.requireCompleteEvidenceForApproval(submission.getId(), mapper.proofScreenshots(submission));
        if (repository.findCurrentForUpdate(submission.getWotbServer(), submission.getWotbAccountId(),
                submission.getVehicleId()).isPresent()) {
            throw new IllegalStateException("MARK3_CURRENT_EXISTS");
        }
        Mark3SubmissionService.requireApprovedValues(
                submission.getClaimedBattleCount(), submission.getClaimedAverageDamage(), submission.getClaimedWinRate());
        submission.setApprovedBattleCount(submission.getClaimedBattleCount());
        submission.setApprovedAverageDamage(submission.getClaimedAverageDamage());
        submission.setApprovedWinRate(Mark3SubmissionService.normalizeWinRate(
                submission.getClaimedWinRate(), "MARK3_INVALID_APPROVED"));
        submission.setStatus(Mark3Status.CURRENT.name());
        submission.setApprovedAt(OffsetDateTime.now());
        submission.setApprovedBy(adminUserId);
        Mark3SubmissionService.clearProofScreenshots(submission);
        final Mark3SubmissionSummaryDto result = mapper.toSummary(repository.saveAndFlush(submission));
        evidenceService.discardForSubmission(submission.getId());
        return result;
    }

    @Transactional
    public Mark3SubmissionSummaryDto reject(
            final String adminUserId, final long submissionId,
            final String rejectReason, final String rejectReasonText) {
        final String reason = Mark3SubmissionService.requireCategory(
                rejectReason, "MARK3_REJECT_REASON_REQUIRED", Mark3SubmissionService.REJECT_CATEGORIES);
        if ("OTHER".equals(reason) && !StringUtils.hasText(rejectReasonText)) {
            throw new IllegalArgumentException("MARK3_REJECT_REASON_TEXT_REQUIRED");
        }
        final String normalizedReasonText = Mark3SubmissionService.normalizeReasonText(
                rejectReasonText, "MARK3_REJECT_REASON_TEXT_TOO_LONG");
        final Mark3Submission submission = repository.findByIdForUpdate(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "MARK3_SUBMISSION_NOT_FOUND"));
        Mark3SubmissionService.requirePending(submission);
        submission.setStatus(Mark3Status.REJECTED.name());
        submission.setRejectedAt(OffsetDateTime.now());
        submission.setRejectedBy(adminUserId);
        submission.setRejectReason(reason);
        submission.setRejectReasonText(normalizedReasonText);
        Mark3SubmissionService.clearProofScreenshots(submission);
        final Mark3SubmissionSummaryDto result = mapper.toSummary(repository.save(submission));
        evidenceService.discardForSubmission(submission.getId());
        return result;
    }

    @Transactional
    public Mark3SubmissionSummaryDto deleteCurrent(
            final String adminUserId, final long submissionId,
            final String deleteReason, final String deleteReasonText) {
        return deleteCurrentInternal(adminUserId, submissionId,
                requireDeleteReason(deleteReason, deleteReasonText), deleteReasonText);
    }

    /** Each row uses its own transaction, preserving partial success and terminal evidence cleanup. */
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

    private static String requireDeleteReason(final String deleteReason, final String deleteReasonText) {
        final String reason = Mark3SubmissionService.requireCategory(
                deleteReason, "MARK3_DELETE_REASON_REQUIRED", Mark3SubmissionService.DELETE_CATEGORIES);
        if ("OTHER".equals(reason) && !StringUtils.hasText(deleteReasonText)) {
            throw new IllegalArgumentException("MARK3_DELETE_REASON_TEXT_REQUIRED");
        }
        return reason;
    }

    private Mark3SubmissionSummaryDto deleteCurrentInternal(
            final String adminUserId, final long submissionId,
            final String reason, final String deleteReasonText) {
        final String normalizedReasonText = Mark3SubmissionService.normalizeReasonText(
                deleteReasonText, "MARK3_DELETE_REASON_TEXT_TOO_LONG");
        final Mark3Submission submission = repository.findByIdForUpdate(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "MARK3_SUBMISSION_NOT_FOUND"));
        if (!Mark3Status.CURRENT.name().equals(submission.getStatus())) {
            throw new IllegalStateException("MARK3_NOT_CURRENT");
        }
        submission.setStatus(Mark3Status.DELETED.name());
        submission.setDeletedAt(OffsetDateTime.now());
        submission.setDeletedBy(adminUserId);
        submission.setDeleteReason(reason);
        submission.setDeleteReasonText(normalizedReasonText);
        Mark3SubmissionService.clearProofScreenshots(submission);
        final Mark3SubmissionSummaryDto result = mapper.toSummary(repository.save(submission));
        evidenceService.discardForSubmission(submission.getId());
        return result;
    }
}

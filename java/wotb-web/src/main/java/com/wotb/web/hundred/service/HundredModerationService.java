package com.wotb.web.hundred.service;

import com.wotb.web.hundred.dto.BulkDeleteItemResult;
import com.wotb.web.hundred.dto.BulkDeleteResultDto;
import com.wotb.web.hundred.dto.HundredSubmissionSummaryDto;
import com.wotb.web.hundred.entity.HundredAdminLog;
import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.hundred.enums.HundredBattleStatus;
import com.wotb.web.hundred.repository.HundredAdminLogRepository;
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

@Service
public class HundredModerationService {
    private final HundredBattleSubmissionRepository repository;
    private final HundredAdminLogRepository auditRepository;
    private final HundredBattleMapper mapper;
    private final HundredReplayEvidenceService evidenceService;
    private final TransactionTemplate transactionTemplate;

    public HundredModerationService(
            final HundredBattleSubmissionRepository repository,
            final HundredAdminLogRepository auditRepository,
            final HundredBattleMapper mapper,
            final HundredReplayEvidenceService evidenceService,
            final PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.auditRepository = auditRepository;
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

    /**
     * 状态无关的管理员删除：任意状态（含 DELETED 软删墓碑）一律物理删除。
     * 审计快照与删除同一事务；回放证据元数据先删（FK RESTRICT），物理回放文件
     * 由 discardForSubmission 的 after-commit 引用计数清理处理。
     */
    @Transactional
    public HundredSubmissionSummaryDto deleteSubmission(
            final String adminUserId, final String adminUsername, final long submissionId,
            final String deleteReason, final String deleteReasonText) {
        return deleteInternal(adminUserId, adminUsername, submissionId,
                requireDeleteReason(deleteReason, deleteReasonText), deleteReasonText);
    }

    public BulkDeleteResultDto bulkDeleteSubmissions(
            final String adminUserId, final String adminUsername, final List<Long> ids,
            final String deleteReason, final String deleteReasonText) {
        final String reason = requireDeleteReason(deleteReason, deleteReasonText);
        final List<BulkDeleteItemResult> results = new ArrayList<>(ids.size());
        int deleted = 0;
        for (final long id : ids) {
            try {
                transactionTemplate.executeWithoutResult(status ->
                        deleteInternal(adminUserId, adminUsername, id, reason, deleteReasonText));
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

    private HundredSubmissionSummaryDto deleteInternal(
            final String adminUserId, final String adminUsername, final long submissionId,
            final String reason, final String deleteReasonText) {
        final HundredBattleSubmission submission = repository.findByIdForUpdate(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "HUNDRED_SUBMISSION_NOT_FOUND"));
        final String trimmedText = StringUtils.hasText(deleteReasonText) ? deleteReasonText.trim() : null;
        // 审计快照记录删除前的原始状态；与删除同一事务：audit 失败 → 不删，删除失败 → 无假审计
        auditRepository.save(HundredAdminLog.deleteSubmission(
                submission, adminUserId, adminUsername, reason, trimmedText));
        // 响应取删除前快照（行即将物理删除）
        final HundredSubmissionSummaryDto result = mapper.toSummary(submission);
        // FK RESTRICT：先删回放证据元数据行，才能物理删除 submission 行
        evidenceService.discardForSubmission(submission.getId());
        repository.delete(submission);
        repository.flush();
        return result;
    }

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

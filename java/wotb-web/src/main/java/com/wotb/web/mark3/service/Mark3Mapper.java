package com.wotb.web.mark3.service;

import com.wotb.web.mark3.dto.Mark3AdminDetailDto;
import com.wotb.web.mark3.dto.Mark3AdminListItemDto;
import com.wotb.web.mark3.dto.Mark3LeaderboardItemDto;
import com.wotb.web.mark3.dto.Mark3LeaderboardPageDto;
import com.wotb.web.mark3.dto.Mark3ReplayEvidenceDto;
import com.wotb.web.mark3.dto.Mark3SubmissionSummaryDto;
import com.wotb.web.mark3.entity.Mark3ReplayEvidence;
import com.wotb.web.mark3.entity.Mark3Submission;
import com.wotb.web.util.Mapper;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/** 三环实体与 DTO 的集中转换；Service/Entity 不手写 toXxx。 */
@Service
public class Mark3Mapper implements Mapper<Mark3Submission, Mark3SubmissionSummaryDto> {

    @Override
    public Mark3SubmissionSummaryDto toDto(final Mark3Submission submission) {
        return toSummary(submission);
    }

    public Mark3SubmissionSummaryDto toSummary(final Mark3Submission submission) {
        return new Mark3SubmissionSummaryDto(
                submission.getId(), submission.getVehicleId(), submission.getVehicleName(), submission.getStatus(),
                submission.getClaimedBattleCount(), submission.getClaimedAverageDamage(), submission.getClaimedWinRate(),
                submission.getApprovedBattleCount(), submission.getApprovedAverageDamage(), submission.getApprovedWinRate(),
                submission.getSubmittedAt(), submission.getApprovedAt(),
                submission.getRejectReason(), submission.getRejectReasonText());
    }

    public Mark3LeaderboardItemDto toLeaderboardItem(final Mark3Submission submission, final Integer rank) {
        return new Mark3LeaderboardItemDto(
                submission.getId(), rank, submission.getVehicleId(), submission.getVehicleName(),
                submission.getNicknameSnapshot(),
                submission.getApprovedBattleCount() == null ? 0 : submission.getApprovedBattleCount(),
                submission.getApprovedAverageDamage() == null ? 0 : submission.getApprovedAverageDamage(),
                submission.getApprovedWinRate(), submission.getApprovedAt());
    }

    public Mark3AdminListItemDto toAdminListItem(final Mark3Submission submission) {
        return new Mark3AdminListItemDto(
                submission.getId(), submission.getStatus(), submission.getVehicleId(), submission.getVehicleName(),
                submission.getGameAccountIdSnapshot(), submission.getNicknameSnapshot(),
                submission.getClaimedBattleCount(), submission.getClaimedAverageDamage(), submission.getClaimedWinRate(),
                submission.getApprovedBattleCount(), submission.getApprovedAverageDamage(), submission.getApprovedWinRate(),
                submission.isReplayParseOk(), submission.isReplayGameIdMatch(),
                submission.isReplayVehicleMatch(), submission.isReplayDistinctBattles(),
                submission.getSubmittedAt(), submission.getApprovedAt(),
                submission.getRejectReason(), submission.getDeleteReason());
    }

    public Mark3AdminDetailDto toAdminDetail(final Mark3Submission submission) {
        final List<String> screenshots = "PENDING".equals(submission.getStatus())
                ? proofScreenshots(submission) : List.of();
        return new Mark3AdminDetailDto(
                submission.getId(), submission.getStatus(), submission.getVehicleId(), submission.getVehicleName(),
                submission.getGameAccountIdSnapshot(), submission.getNicknameSnapshot(),
                submission.getClaimedBattleCount(), submission.getClaimedAverageDamage(), submission.getClaimedWinRate(),
                submission.getApprovedBattleCount(), submission.getApprovedAverageDamage(), submission.getApprovedWinRate(),
                screenshots,
                submission.isReplayParseOk(), submission.isReplayGameIdMatch(),
                submission.isReplayVehicleMatch(), submission.isReplayDistinctBattles(),
                submission.getSubmittedAt(), submission.getApprovedAt(), submission.getApprovedBy(),
                submission.getRejectedAt(), submission.getRejectedBy(),
                submission.getRejectReason(), submission.getRejectReasonText(), submission.getCancelledAt(),
                submission.getDeletedAt(), submission.getDeletedBy(),
                submission.getDeleteReason(), submission.getDeleteReasonText());
    }

    public Mark3ReplayEvidenceDto toReplayEvidenceDto(final Mark3ReplayEvidence evidence) {
        return new Mark3ReplayEvidenceDto(
                evidence.getId(), evidence.getSlot(), evidence.getOriginalFilename(),
                evidence.getFileSize(), evidence.getArenaId(), evidence.getSha256(), evidence.getCreatedAt());
    }

    public Mark3LeaderboardPageDto toLeaderboardPage(
            final Page<Mark3Submission> page,
            final Long vehicleId,
            final String vehicleName,
            final int pageNumber,
            final int pageSize,
            final Map<Integer, Integer> rankByBattleCount) {
        return new Mark3LeaderboardPageDto(
                vehicleId, vehicleName, toLeaderboardItems(page.getContent(), rankByBattleCount),
                pageNumber, pageSize, page.getTotalElements(), page.getTotalPages());
    }

    public Mark3LeaderboardPageDto toTopLeaderboardPage(
            final List<Mark3Submission> submissions,
            final int displaySize,
            final Map<Integer, Integer> rankByBattleCount) {
        final List<Mark3LeaderboardItemDto> items = toLeaderboardItems(submissions, rankByBattleCount);
        return new Mark3LeaderboardPageDto(
                null, null, items, 1, displaySize, items.size(), items.isEmpty() ? 0 : 1);
    }

    /** PENDING 证据截图按字段顺序返回，空值不会泄露为 null list item。 */
    public List<String> proofScreenshots(final Mark3Submission submission) {
        return Stream.of(submission.getProofScreenshotFirst(), submission.getProofScreenshotSecond())
                .filter(StringUtils::hasText)
                .toList();
    }

    private List<Mark3LeaderboardItemDto> toLeaderboardItems(
            final List<Mark3Submission> submissions,
            final Map<Integer, Integer> rankByBattleCount) {
        return submissions.stream()
                .map(submission -> {
                    final int battleCount = submission.getApprovedBattleCount() == null
                            ? 0 : submission.getApprovedBattleCount();
                    return toLeaderboardItem(submission, rankByBattleCount.get(battleCount));
                })
                .toList();
    }
}

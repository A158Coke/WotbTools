package com.wotb.web.hundred.service;

import com.wotb.web.hundred.dto.HundredAdminDetailDto;
import com.wotb.web.hundred.dto.HundredAdminListItemDto;
import com.wotb.web.hundred.dto.HundredLeaderboardItemDto;
import com.wotb.web.hundred.dto.HundredLeaderboardPageDto;
import com.wotb.web.hundred.dto.HundredReplayEvidenceDto;
import com.wotb.web.hundred.dto.HundredSubmissionSummaryDto;
import com.wotb.web.hundred.entity.HundredBattleReplayEvidence;
import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.util.Mapper;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
public class HundredBattleMapper implements Mapper<HundredBattleSubmission, HundredSubmissionSummaryDto> {

    @Override
    public HundredSubmissionSummaryDto toDto(final HundredBattleSubmission s) {
        return toSummary(s);
    }

    public HundredSubmissionSummaryDto toSummary(final HundredBattleSubmission s) {
        return new HundredSubmissionSummaryDto(
                s.getId(), s.getVehicleId(), s.getVehicleName(), s.getStatus(),
                s.getClaimedAverageDamage(), s.getClaimedBattleCount(),
                s.getApprovedAverageDamage(), s.getApprovedBattleCount(),
                s.getSubmittedAt(), s.getApprovedAt(), s.getRejectReason(), s.getRejectReasonText());
    }

    public HundredLeaderboardItemDto toLeaderboardItem(final HundredBattleSubmission s, final Integer rank) {
        return new HundredLeaderboardItemDto(
                s.getId(), rank, s.getVehicleId(), s.getVehicleName(), s.getNicknameSnapshot(),
                s.getApprovedAverageDamage() == null ? 0 : s.getApprovedAverageDamage(),
                s.getApprovedBattleCount() == null ? 0 : s.getApprovedBattleCount(),
                s.getApprovedAt());
    }

    public HundredAdminListItemDto toAdminListItem(final HundredBattleSubmission s) {
        return new HundredAdminListItemDto(
                s.getId(), s.getStatus(), s.getVehicleId(), s.getVehicleName(),
                s.getWotbServer(), s.getWotbAccountId(), s.getNicknameSnapshot(),
                s.getApprovedAverageDamage(), s.getApprovedBattleCount() == null
                        ? null : s.getApprovedBattleCount().longValue(),
                s.isReplayParseOk(), s.isReplayGameIdMatch(),
                s.isReplayVehicleMatch(), s.isReplayDistinctBattles(),
                s.getSubmittedAt(), s.getApprovedAt(), s.getRejectReason(), s.getDeleteReason());
    }

    public HundredReplayEvidenceDto toReplayEvidenceDto(final HundredBattleReplayEvidence e) {
        return new HundredReplayEvidenceDto(
                e.getId(), e.getSlot(), e.getOriginalFilename(),
                e.getFileSize(), e.getArenaId(), e.getSha256(), e.getCreatedAt());
    }

    public HundredAdminDetailDto toAdminDetail(final HundredBattleSubmission s) {
        final boolean pending = "PENDING".equals(s.getStatus());
        return new HundredAdminDetailDto(
                s.getId(), s.getStatus(), s.getVehicleId(), s.getVehicleName(),
                s.getWotbServer(), s.getWotbAccountId(), s.getNicknameSnapshot(),
                s.getClaimedAverageDamage(), s.getClaimedBattleCount(),
                s.getApprovedAverageDamage(), s.getApprovedBattleCount(),
                pending ? s.getProofScreenshot() : null,
                s.isReplayParseOk(), s.isReplayGameIdMatch(),
                s.isReplayVehicleMatch(), s.isReplayDistinctBattles(),
                s.getSubmittedAt(), s.getApprovedAt(), s.getApprovedBy(),
                s.getRejectedAt(), s.getRejectedBy(), s.getRejectReason(), s.getRejectReasonText(),
                s.getCancelledAt(),
                s.getDeletedAt(), s.getDeletedBy(), s.getDeleteReason(), s.getDeleteReasonText());
    }

    public HundredLeaderboardPageDto toLeaderboardPage(
            final Page<HundredBattleSubmission> page,
            final Long vehicleId,
            final String vehicleName,
            final int pageNumber,
            final int pageSize,
            final Map<Integer, Integer> rankByDamage) {
        final List<HundredLeaderboardItemDto> items = toLeaderboardItems(page.getContent(), rankByDamage);
        return new HundredLeaderboardPageDto(vehicleId, vehicleName, items,
                pageNumber, pageSize, page.getTotalElements(), page.getTotalPages());
    }

    public HundredLeaderboardPageDto toTopLeaderboardPage(
            final List<HundredBattleSubmission> submissions,
            final int displaySize,
            final Map<Integer, Integer> rankByDamage) {
        final List<HundredLeaderboardItemDto> items = toLeaderboardItems(submissions, rankByDamage);
        return new HundredLeaderboardPageDto(null, null, items,
                1, displaySize, items.size(), items.isEmpty() ? 0 : 1);
    }

    private List<HundredLeaderboardItemDto> toLeaderboardItems(
            final List<HundredBattleSubmission> submissions,
            final Map<Integer, Integer> rankByDamage) {
        return submissions.stream()
                .map(s -> {
                    final int damage = s.getApprovedAverageDamage() == null ? 0 : s.getApprovedAverageDamage();
                    return toLeaderboardItem(s, rankByDamage.get(damage));
                })
                .toList();
    }
}

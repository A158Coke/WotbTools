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

/**
 * 百场实体 ↔ DTO 集中转换（禁止 Service/Entity 手写 toXxx）。
 */
@Service
public class HundredBattleMapper implements Mapper<HundredBattleSubmission, HundredSubmissionSummaryDto> {

    @Override
    public HundredSubmissionSummaryDto toDto(final HundredBattleSubmission s) {
        return toSummary(s);
    }

    /**
     * 个人中心摘要。
     */
    public HundredSubmissionSummaryDto toSummary(final HundredBattleSubmission s) {
        return new HundredSubmissionSummaryDto(
                s.getId(), s.getVehicleId(), s.getVehicleName(), s.getStatus(),
                s.getClaimedAverageDamage(), s.getClaimedBattleCount(),
                s.getApprovedAverageDamage(), s.getApprovedBattleCount(),
                s.getSubmittedAt(), s.getApprovedAt(), s.getRejectReason(), s.getRejectReasonText());
    }

    /**
     * 公开排行榜行；rank 为 query-time 派生的 competition ranking（无上下文时传 null）。
     */
    public HundredLeaderboardItemDto toLeaderboardItem(final HundredBattleSubmission s, final Integer rank) {
        return new HundredLeaderboardItemDto(
                s.getId(), rank, s.getVehicleId(), s.getVehicleName(), s.getNicknameSnapshot(),
                s.getApprovedAverageDamage() == null ? 0 : s.getApprovedAverageDamage(),
                s.getApprovedBattleCount() == null ? 0 : s.getApprovedBattleCount(),
                s.getApprovedAt());
    }

    /**
     * 管理后台列表行（不含 proof 截图）。
     */
    public HundredAdminListItemDto toAdminListItem(final HundredBattleSubmission s) {
        return new HundredAdminListItemDto(
                s.getId(), s.getStatus(), s.getVehicleId(), s.getVehicleName(),
                s.getGameAccountIdSnapshot(), s.getNicknameSnapshot(),
                s.getClaimedAverageDamage(), s.getClaimedBattleCount(),
                s.getApprovedAverageDamage(), s.getApprovedBattleCount(),
                s.isReplayParseOk(), s.isReplayGameIdMatch(),
                s.isReplayVehicleMatch(), s.isReplayDistinctBattles(),
                s.getSubmittedAt(), s.getApprovedAt(), s.getRejectReason(), s.getDeleteReason());
    }

    /**
     * 管理后台回放证据 metadata（admin-only；不含文件内容）。
     */
    public HundredReplayEvidenceDto toReplayEvidenceDto(final HundredBattleReplayEvidence e) {
        return new HundredReplayEvidenceDto(
                e.getId(), e.getSlot(), e.getOriginalFilename(),
                e.getFileSize(), e.getArenaId(), e.getSha256(), e.getCreatedAt());
    }

    /**
     * 管理后台详情；proofScreenshot 仅 PENDING 时对外（终态事务内已清空，双重保护）。
     */
    public HundredAdminDetailDto toAdminDetail(final HundredBattleSubmission s) {
        final boolean pending = "PENDING".equals(s.getStatus());
        return new HundredAdminDetailDto(
                s.getId(), s.getStatus(), s.getVehicleId(), s.getVehicleName(),
                s.getGameAccountIdSnapshot(), s.getNicknameSnapshot(),
                s.getClaimedAverageDamage(), s.getClaimedBattleCount(),
                s.getApprovedAverageDamage(), s.getApprovedBattleCount(),
                pending ? s.getProofScreenshot() : null,
                s.isReplayParseOk(), s.isReplayGameIdMatch(),
                s.isReplayVehicleMatch(), s.isReplayDistinctBattles(),
                s.getSubmittedAt(), s.getApprovedAt(), s.getApprovedBy(),
                s.getRejectedAt(), s.getRejectedBy(), s.getRejectReason(), s.getRejectReasonText(),
                s.getDeletedAt(), s.getDeletedBy(), s.getDeleteReason(), s.getDeleteReasonText());
    }

    /**
     * 公开分页 + competition ranking（1,2,2,4；同分并列，下一名跳号）。
     * rankByDamage 由服务端对「全部 CURRENT 按伤害分组计数」做前缀和得到，
     * 保证跨页并列（tie 横跨分页边界）时排名依然全局正确。
     */
    public HundredLeaderboardPageDto toLeaderboardPage(
            final Page<HundredBattleSubmission> page,
            final long vehicleId,
            final String vehicleName,
            final int pageNumber,
            final int pageSize,
            final Map<Integer, Integer> rankByDamage) {
        final List<HundredLeaderboardItemDto> items = page.getContent().stream()
                .map(s -> {
                    final int damage = s.getApprovedAverageDamage() == null ? 0 : s.getApprovedAverageDamage();
                    return toLeaderboardItem(s, rankByDamage.get(damage));
                })
                .toList();
        return new HundredLeaderboardPageDto(vehicleId, vehicleName, items,
                pageNumber, pageSize, page.getTotalElements(), page.getTotalPages());
    }
}

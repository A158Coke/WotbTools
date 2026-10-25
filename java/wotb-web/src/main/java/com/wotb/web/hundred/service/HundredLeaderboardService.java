package com.wotb.web.hundred.service;

import com.wotb.core.model.TankInfo;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.ref.VehicleCodes;
import com.wotb.web.hundred.dto.HundredLeaderboardPageDto;
import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.hundred.repository.HundredBattleSubmissionRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 百场公开排行榜查询；排名在查询时派生，不改变持久化成绩。 */
@Service
public class HundredLeaderboardService {
    private static final int DEFAULT_PAGE_SIZE = 50;
    private static final int MAX_PAGE_SIZE = 100;
    private static final int TOP_LEADERBOARD_SIZE = 10;

    private final HundredBattleSubmissionRepository repository;
    private final HundredBattleMapper mapper;
    private final Tankopedia tankopedia = Tankopedia.load();

    public HundredLeaderboardService(
            final HundredBattleSubmissionRepository repository,
            final HundredBattleMapper mapper) {
        this.repository = repository;
        this.mapper = mapper;
    }

    /**
     * 公开排行榜：vehicleId / nation / vehicleType 按交集处理。
     * 全部为空走全站 Top 10；仅分类条件走候选车辆集合内 Top 10；具体车辆保持独立分页。
     * rank query-time 派生不落库，且始终基于与结果集完全相同的筛选上下文。
     */
    @Transactional(readOnly = true)
    public HundredLeaderboardPageDto leaderboard(final Long vehicleId,
                                                  final String nation,
                                                  final String vehicleType,
                                                  final int page,
                                                  final int size) {
        final String nationFilter = normalizeCategoryFilter(nation);
        final String typeFilter = normalizeCategoryFilter(vehicleType);
        if (vehicleId == null && nationFilter == null && typeFilter == null) {
            return defaultLeaderboard();
        }
        if (vehicleId == null) {
            return categoryLeaderboard(nationFilter, typeFilter);
        }
        final TankInfo vehicle = tankopedia.info(vehicleId);
        if (!isTierTen(vehicle)) {
            throw new IllegalArgumentException("HUNDRED_NON_TIER_X");
        }
        final int effectiveSize = clamp(size);
        if (!matchesCategory(vehicle, nationFilter, typeFilter)) {
            final Page<HundredBattleSubmission> empty = Page.empty(
                    PageRequest.of(Math.max(0, page - 1), effectiveSize));
            return mapper.toLeaderboardPage(empty, vehicleId, vehicle.name(), page, effectiveSize, Map.of());
        }
        final Page<HundredBattleSubmission> rows = repository
                .findByVehicleIdAndStatusOrderByApprovedAverageDamageDescApprovedAtAscIdAsc(
                        vehicleId, "CURRENT", PageRequest.of(Math.max(0, page - 1), effectiveSize));
        return mapper.toLeaderboardPage(rows, vehicleId, vehicle.name(), page, effectiveSize, rankMap(vehicleId));
    }

    /** 分类筛选视图：由 CURRENT 的权威 Tier X vehicleId 派生候选集合，固定返回该上下文 Top 10。 */
    private HundredLeaderboardPageDto categoryLeaderboard(final String nation, final String vehicleType) {
        final List<Long> vehicleIds = repository.findDistinctCurrentVehicleIds().stream()
                .filter(id -> matchesCategory(tankopedia.info(id), nation, vehicleType))
                .toList();
        if (vehicleIds.isEmpty()) {
            return mapper.toTopLeaderboardPage(List.of(), TOP_LEADERBOARD_SIZE, Map.of());
        }
        final List<HundredBattleSubmission> rows = repository.findTopCurrentByVehicleIds(
                vehicleIds, PageRequest.of(0, TOP_LEADERBOARD_SIZE));
        return mapper.toTopLeaderboardPage(rows, TOP_LEADERBOARD_SIZE,
                rankMap(repository.countCurrentGroupedByDamageForVehicles(vehicleIds)));
    }

    /** 未筛选车辆时的默认视图：全站 CURRENT 伤害最高十条，固定首屏且不翻页。 */
    private HundredLeaderboardPageDto defaultLeaderboard() {
        final List<HundredBattleSubmission> rows = repository
                .findTop10ByStatusAndApprovedAverageDamageIsNotNullOrderByApprovedAverageDamageDescApprovedAtAscIdAsc(
                        "CURRENT");
        return mapper.toTopLeaderboardPage(rows, TOP_LEADERBOARD_SIZE,
                rankMap(repository.countAllCurrentGroupedByDamage()));
    }

    /** 全部 CURRENT 按伤害分组计数 → 前缀和 → damage → rank（跨页并列也全局正确）。 */
    private Map<Integer, Integer> rankMap(final long vehicleId) {
        return rankMap(repository.countCurrentGroupedByDamage(vehicleId));
    }

    private static Map<Integer, Integer> rankMap(final List<Object[]> groups) {
        final List<int[]> sorted = groups.stream()
                .map(group -> new int[]{((Number) group[0]).intValue(), ((Number) group[1]).intValue()})
                .sorted(Comparator.comparingInt((int[] group) -> group[0]).reversed())
                .toList();
        final Map<Integer, Integer> rank = new HashMap<>();
        int higher = 0;
        for (final int[] group : sorted) {
            rank.put(group[0], higher + 1);
            higher += group[1];
        }
        return rank;
    }

    private static String normalizeCategoryFilter(final String value) {
        return StringUtils.hasText(value) ? value.trim().toUpperCase(java.util.Locale.ROOT) : null;
    }

    private static boolean isTierTen(final TankInfo vehicle) {
        return vehicle.tier() instanceof final Number tier && tier.intValue() == 10;
    }

    static boolean matchesCategory(final TankInfo vehicle,
                                   final String nation,
                                   final String vehicleType) {
        return isTierTen(vehicle)
                && (nation == null || nation.equals(VehicleCodes.nationCode(vehicle.nation())))
                && (vehicleType == null || vehicleType.equals(VehicleCodes.classCode(vehicle.type())));
    }

    private static int clamp(final int size) {
        if (size <= 0) return DEFAULT_PAGE_SIZE;
        return Math.min(size, MAX_PAGE_SIZE);
    }
}

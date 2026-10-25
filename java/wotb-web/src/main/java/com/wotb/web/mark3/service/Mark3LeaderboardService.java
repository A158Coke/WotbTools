package com.wotb.web.mark3.service;

import com.wotb.core.model.TankInfo;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.ref.VehicleCodes;
import com.wotb.web.mark3.dto.Mark3LeaderboardPageDto;
import com.wotb.web.mark3.entity.Mark3Submission;
import com.wotb.web.mark3.enums.Mark3Status;
import com.wotb.web.mark3.repository.Mark3SubmissionRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** 三环公开排行榜查询；排名在查询时派生，不改变持久化成绩。 */
@Service
public class Mark3LeaderboardService {
    private static final int DEFAULT_PAGE_SIZE = 50;
    private static final int MAX_PAGE_SIZE = 100;
    private static final int TOP_LEADERBOARD_SIZE = 10;

    private final Mark3SubmissionRepository repository;
    private final Mark3Mapper mapper;
    private final Tankopedia tankopedia = Tankopedia.load();

    public Mark3LeaderboardService(final Mark3SubmissionRepository repository, final Mark3Mapper mapper) {
        this.repository = repository;
        this.mapper = mapper;
    }

    /** 具体车辆分页；未指定车辆时为全站或 nation/type 交集的固定 Top 10。 */
    @Transactional(readOnly = true)
    public Mark3LeaderboardPageDto leaderboard(
            final Long vehicleId, final String nation, final String vehicleType, final int page, final int size) {
        final String nationFilter = normalizeCategoryFilter(nation);
        final String typeFilter = normalizeCategoryFilter(vehicleType);
        if (vehicleId == null && nationFilter == null && typeFilter == null) return defaultLeaderboard();
        if (vehicleId == null) return categoryLeaderboard(nationFilter, typeFilter);
        final TankInfo vehicle = tankopedia.info(vehicleId);
        if (!isTierTen(vehicle)) throw new IllegalArgumentException("MARK3_NON_TIER_X");
        final int effectiveSize = clamp(size);
        if (!matchesCategory(vehicle, nationFilter, typeFilter)) {
            final Page<Mark3Submission> empty = Page.empty(PageRequest.of(Math.max(0, page - 1), effectiveSize));
            return mapper.toLeaderboardPage(empty, vehicleId, vehicle.name(), page, effectiveSize, Map.of());
        }
        final Page<Mark3Submission> rows = repository
                .findByVehicleIdAndStatusOrderByApprovedBattleCountAscApprovedAtAscIdAsc(
                        vehicleId, Mark3Status.CURRENT.name(),
                        PageRequest.of(Math.max(0, page - 1), effectiveSize));
        return mapper.toLeaderboardPage(rows, vehicleId, vehicle.name(), page, effectiveSize, rankMap(vehicleId));
    }

    private Mark3LeaderboardPageDto categoryLeaderboard(final String nation, final String vehicleType) {
        final List<Long> vehicleIds = repository.findDistinctCurrentVehicleIds().stream()
                .filter(id -> matchesCategory(tankopedia.info(id), nation, vehicleType)).toList();
        if (vehicleIds.isEmpty()) return mapper.toTopLeaderboardPage(List.of(), TOP_LEADERBOARD_SIZE, Map.of());
        final List<Mark3Submission> rows = repository.findTopCurrentByVehicleIds(
                vehicleIds, PageRequest.of(0, TOP_LEADERBOARD_SIZE));
        return mapper.toTopLeaderboardPage(rows, TOP_LEADERBOARD_SIZE,
                rankMap(repository.countCurrentGroupedByBattleCountForVehicles(vehicleIds)));
    }

    private Mark3LeaderboardPageDto defaultLeaderboard() {
        final List<Mark3Submission> rows = repository
                .findTop10ByStatusAndApprovedBattleCountIsNotNullOrderByApprovedBattleCountAscApprovedAtAscIdAsc(
                        Mark3Status.CURRENT.name());
        return mapper.toTopLeaderboardPage(rows, TOP_LEADERBOARD_SIZE,
                rankMap(repository.countAllCurrentGroupedByBattleCount()));
    }

    private Map<Integer, Integer> rankMap(final long vehicleId) {
        return rankMap(repository.countCurrentGroupedByBattleCount(vehicleId));
    }

    private static Map<Integer, Integer> rankMap(final List<Object[]> groups) {
        final List<int[]> sorted = groups.stream()
                .map(group -> new int[]{((Number) group[0]).intValue(), ((Number) group[1]).intValue()})
                .sorted(Comparator.comparingInt(group -> group[0])).toList();
        final Map<Integer, Integer> ranks = new HashMap<>();
        int fewer = 0;
        for (final int[] group : sorted) {
            ranks.put(group[0], fewer + 1);
            fewer += group[1];
        }
        return ranks;
    }

    private static String normalizeCategoryFilter(final String value) {
        return StringUtils.hasText(value) ? value.trim().toUpperCase(java.util.Locale.ROOT) : null;
    }

    private static boolean isTierTen(final TankInfo vehicle) {
        return vehicle.tier() instanceof final Number tier && tier.intValue() == 10;
    }

    static boolean matchesCategory(final TankInfo vehicle, final String nation, final String vehicleType) {
        return isTierTen(vehicle)
                && (nation == null || nation.equals(VehicleCodes.nationCode(vehicle.nation())))
                && (vehicleType == null || vehicleType.equals(VehicleCodes.classCode(vehicle.type())));
    }

    private static int clamp(final int size) {
        return size <= 0 ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE);
    }
}

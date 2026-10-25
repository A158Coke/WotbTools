package com.wotb.web.hundred.service;

import com.wotb.core.model.TankInfo;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.hundred.dto.HundredAdminDetailDto;
import com.wotb.web.hundred.dto.HundredAdminPageDto;
import com.wotb.web.hundred.entity.HundredBattleSubmission;
import com.wotb.web.hundred.enums.HundredBattleStatus;
import com.wotb.web.hundred.repository.HundredBattleSubmissionRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Locale;

/** 百场管理列表与详情查询。 */
@Service
public class HundredAdminQueryService {
    private static final int DEFAULT_PAGE_SIZE = 50;
    private static final int MAX_PAGE_SIZE = 100;

    private final HundredBattleSubmissionRepository repository;
    private final HundredBattleMapper mapper;
    private final Tankopedia tankopedia = Tankopedia.load();

    public HundredAdminQueryService(
            final HundredBattleSubmissionRepository repository, final HundredBattleMapper mapper) {
        this.repository = repository;
        this.mapper = mapper;
    }

    @Transactional(readOnly = true)
    public HundredAdminPageDto adminList(final String status, final int page, final int size) {
        return adminList(status, null, null, null, page, size);
    }

    @Transactional(readOnly = true)
    public HundredAdminPageDto adminList(
            final String status, final String nation, final String vehicleType,
            final Long vehicleId, final int page, final int size) {
        final String normalized = StringUtils.hasText(status) ? HundredBattleStatus.from(status).name() : null;
        final int effectiveSize = clamp(size);
        final PageRequest pageable = PageRequest.of(Math.max(0, page - 1), effectiveSize);
        final String nationFilter = normalizeCategoryFilter(nation);
        final String typeFilter = normalizeCategoryFilter(vehicleType);
        final Page<HundredBattleSubmission> rows;
        if (vehicleId == null && nationFilter == null && typeFilter == null) {
            rows = repository.searchAdmin(normalized, pageable);
        } else {
            final List<Long> vehicleIds = vehicleId == null
                    ? repository.findDistinctVehicleIds().stream()
                            .filter(id -> HundredLeaderboardService.matchesCategory(
                                    tankopedia.info(id), nationFilter, typeFilter))
                            .toList()
                    : HundredLeaderboardService.matchesCategory(
                            tankopedia.info(vehicleId), nationFilter, typeFilter)
                            ? List.of(vehicleId) : List.of();
            rows = vehicleIds.isEmpty() ? Page.empty(pageable)
                    : repository.searchAdminByVehicleIds(normalized, vehicleIds, pageable);
        }
        return new HundredAdminPageDto(rows.getContent().stream().map(mapper::toAdminListItem).toList(),
                page, effectiveSize, rows.getTotalElements(), rows.getTotalPages());
    }

    @Transactional(readOnly = true)
    public HundredAdminDetailDto adminDetail(final long submissionId) {
        final HundredBattleSubmission submission = repository.findById(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "HUNDRED_SUBMISSION_NOT_FOUND"));
        return mapper.toAdminDetail(submission);
    }

    private static String normalizeCategoryFilter(final String value) {
        return StringUtils.hasText(value) ? value.trim().toUpperCase(Locale.ROOT) : null;
    }

    private static int clamp(final int size) {
        return size <= 0 ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE);
    }
}

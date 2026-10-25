package com.wotb.web.mark3.service;

import com.wotb.core.model.TankInfo;
import com.wotb.core.ref.Tankopedia;
import com.wotb.web.mark3.dto.Mark3AdminDetailDto;
import com.wotb.web.mark3.dto.Mark3AdminPageDto;
import com.wotb.web.mark3.entity.Mark3Submission;
import com.wotb.web.mark3.enums.Mark3Status;
import com.wotb.web.mark3.repository.Mark3SubmissionRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Locale;

/** 三环管理列表与详情查询。 */
@Service
public class Mark3AdminQueryService {
    private static final int DEFAULT_PAGE_SIZE = 50;
    private static final int MAX_PAGE_SIZE = 100;

    private final Mark3SubmissionRepository repository;
    private final Mark3Mapper mapper;
    private final Tankopedia tankopedia = Tankopedia.load();

    public Mark3AdminQueryService(final Mark3SubmissionRepository repository, final Mark3Mapper mapper) {
        this.repository = repository;
        this.mapper = mapper;
    }

    @Transactional(readOnly = true)
    public Mark3AdminPageDto adminList(
            final String status, final String nation, final String vehicleType,
            final Long vehicleId, final int page, final int size) {
        final String normalizedStatus = StringUtils.hasText(status)
                ? Mark3Status.from(status.trim().toUpperCase(Locale.ROOT)).name() : null;
        final int effectiveSize = clamp(size);
        final PageRequest pageable = PageRequest.of(Math.max(0, page - 1), effectiveSize);
        final String nationFilter = normalizeCategoryFilter(nation);
        final String typeFilter = normalizeCategoryFilter(vehicleType);
        final Page<Mark3Submission> rows;
        if (vehicleId == null && nationFilter == null && typeFilter == null) {
            rows = repository.searchAdmin(normalizedStatus, pageable);
        } else {
            final List<Long> vehicleIds = vehicleId == null
                    ? repository.findDistinctVehicleIds().stream()
                            .filter(id -> Mark3LeaderboardService.matchesCategory(
                                    tankopedia.info(id), nationFilter, typeFilter))
                            .toList()
                    : Mark3LeaderboardService.matchesCategory(
                            tankopedia.info(vehicleId), nationFilter, typeFilter)
                            ? List.of(vehicleId) : List.of();
            rows = vehicleIds.isEmpty() ? Page.empty(pageable)
                    : repository.searchAdminByVehicleIds(normalizedStatus, vehicleIds, pageable);
        }
        return new Mark3AdminPageDto(rows.getContent().stream().map(mapper::toAdminListItem).toList(),
                page, effectiveSize, rows.getTotalElements(), rows.getTotalPages());
    }

    @Transactional(readOnly = true)
    public Mark3AdminDetailDto adminDetail(final long submissionId) {
        final Mark3Submission submission = repository.findById(submissionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "MARK3_SUBMISSION_NOT_FOUND"));
        return mapper.toAdminDetail(submission);
    }

    private static String normalizeCategoryFilter(final String value) {
        return StringUtils.hasText(value) ? value.trim().toUpperCase(Locale.ROOT) : null;
    }

    private static int clamp(final int size) {
        return size <= 0 ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE);
    }
}

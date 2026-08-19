package com.wotb.web.boost.service;

import com.wotb.web.boost.repository.BoostRequestAssignmentRepository;
import org.springframework.stereotype.Service;

/** 跨域只读统计服务 — 打破 BoosterService / BoostAssignmentService 循环依赖。 */
@Service
public class BoostStatsService {

    private final BoostRequestAssignmentRepository assignmentRepository;

    public BoostStatsService(final BoostRequestAssignmentRepository assignmentRepository) {
        this.assignmentRepository = assignmentRepository;
    }

    public long activeAssignmentCount(final Long boosterId) {
        return assignmentRepository.countByBoosterIdAndUnassignedAtIsNull(boosterId);
    }
}

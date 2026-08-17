package com.wotb.web.hof.repository;

import com.wotb.web.hof.entity.HallOfFameAdminLog;
import org.springframework.data.jpa.repository.JpaRepository;

/** 名人堂管理操作审计仓库（只读；无 retention / cleanup，第一版）。 */
public interface HallOfFameAdminLogRepository extends JpaRepository<HallOfFameAdminLog, Long> {
}

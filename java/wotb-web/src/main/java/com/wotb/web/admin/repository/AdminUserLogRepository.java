package com.wotb.web.admin.repository;

import com.wotb.web.admin.entity.AdminUserLog;
import org.springframework.data.jpa.repository.JpaRepository;

/** 管理员操作日志仓库。 */
public interface AdminUserLogRepository extends JpaRepository<AdminUserLog, Long> {
}

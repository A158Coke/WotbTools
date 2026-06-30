package com.wotb.web.admin;

import org.springframework.data.jpa.repository.JpaRepository;

/** 管理员删除审计日志仓库。 */
public interface AdminUserDeletionLogRepository extends JpaRepository<AdminUserDeletionLog, Long> {
}

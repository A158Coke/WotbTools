package com.wotb.web.admin.repository;

import com.wotb.web.admin.entity.AdminUserLog;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AdminUserLogRepository extends JpaRepository<AdminUserLog, Long> {
}

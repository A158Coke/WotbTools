package com.wotb.web.admin.service;

import com.wotb.web.admin.entity.AdminUserLog;
import com.wotb.web.admin.repository.AdminUserLogRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** 管理员操作日志持久化。独立事务确保审计日志不回滚。 */
@Component
public class AdminUserLogPersister {

    private final AdminUserLogRepository repository;

    public AdminUserLogPersister(final AdminUserLogRepository repository) {
        this.repository = repository;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public AdminUserLog save(final AdminUserLog log) {
        return repository.save(log);
    }
}

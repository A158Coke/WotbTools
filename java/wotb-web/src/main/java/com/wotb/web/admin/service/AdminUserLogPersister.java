package com.wotb.web.admin.service;

import com.wotb.web.admin.entity.AdminUserLog;
import com.wotb.web.admin.repository.AdminUserLogRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

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

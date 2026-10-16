package com.wotb.web.user.service;

import com.wotb.web.user.entity.AdminUserLog;
import com.wotb.web.user.repository.AdminUserLogRepository;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
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
        final AdminUserLog saved = repository.save(log);
        if ("DELETE_USER".equals(saved.getOperation()) && !saved.isKeycloakUserDeleted()
                && AdminUserLog.FAILED_KEYCLOAK_DELETE.equals(saved.getStatus())) {
            repository.flush();
            // The caller still holds settings WRITE. A confirmed-live account resolves
            // older uncertain attempts, while successful deletion facts stay immutable.
            repository.resolvePendingDeletes(saved.getTargetKeycloakUserId(),
                    AdminUserLog.KEYCLOAK_DELETE_PENDING, AdminUserLog.FAILED_KEYCLOAK_DELETE);
        }
        return saved;
    }

    /** Called after the creator settings lock, so queued JWT writes observe the deletion outcome. */
    @Transactional(propagation = Propagation.MANDATORY, readOnly = true)
    public void requireAccountWritable(final String subject) {
        if (repository.hasAccountDeletionBarrier(subject, AdminUserLog.KEYCLOAK_DELETE_PENDING)) {
            throw new ApiException(ApiErrorCode.AUTH_UNAUTHENTICATED);
        }
    }
}

package com.wotb.web.user.repository;

import com.wotb.web.user.entity.AdminUserLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** 管理员操作日志仓库。 */
public interface AdminUserLogRepository extends JpaRepository<AdminUserLog, Long> {
    @Query(value = """
            select exists (select 1 from admin_user_log where operation = 'DELETE_USER' and target_keycloak_user_id = :subject
              and (keycloak_user_deleted or status = :pending))
            """, nativeQuery = true)
    boolean hasAccountDeletionBarrier(@Param("subject") String subject, @Param("pending") String pending);

    @Modifying
    @Query(value = """
            update admin_user_log set status = :resolved, updated_at = current_timestamp
            where operation = 'DELETE_USER' and target_keycloak_user_id = :subject
              and status = :pending and not keycloak_user_deleted
            """, nativeQuery = true)
    void resolvePendingDeletes(@Param("subject") String subject, @Param("pending") String pending,
                               @Param("resolved") String resolved);
}

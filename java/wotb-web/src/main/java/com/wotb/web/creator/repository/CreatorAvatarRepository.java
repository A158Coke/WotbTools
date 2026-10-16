package com.wotb.web.creator.repository;

import com.wotb.web.creator.entity.CreatorAvatar;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface CreatorAvatarRepository extends JpaRepository<CreatorAvatar, String> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from CreatorAvatar a where a.id = :id")
    Optional<CreatorAvatar> findLocked(@Param("id") String id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from CreatorAvatar a where a.subject = :subject order by a.id")
    List<CreatorAvatar> findOwnedLocked(@Param("subject") String subject);

    @Query(value = """
            select a.id from creator_avatar a
            where (a.keycloak_subject is null or coalesce(a.unreferenced_at, a.created_at) < :cutoff)
              and not exists (select 1 from creator c where c.avatar_id = a.id)
            order by coalesce(a.last_cleanup_attempt_at, a.unreferenced_at, a.created_at), a.id limit 100
            """, nativeQuery = true)
    List<String> findExpiredUnreferenced(@Param("cutoff") Instant cutoff);
}

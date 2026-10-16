package com.wotb.web.tournament.repository;

import com.wotb.web.tournament.entity.BroadcastCover;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface BroadcastCoverRepository extends JpaRepository<BroadcastCover, String> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from BroadcastCover c where c.id = :id")
    Optional<BroadcastCover> findLocked(@Param("id") String id);

    @Query(value = """
            select c.id from tournament_broadcast_cover c
            where coalesce(c.unreferenced_at, c.created_at) < :cutoff
              and not exists (select 1 from tournament_broadcast_replay r where r.cover_id = c.id)
            order by coalesce(c.unreferenced_at, c.created_at), c.id
            """, nativeQuery = true)
    List<String> findExpiredUnreferenced(@Param("cutoff") Instant cutoff);
}

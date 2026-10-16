package com.wotb.web.tournament.repository;

import com.wotb.web.tournament.entity.BroadcastSeason;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Optional;

public interface BroadcastSeasonRepository extends JpaRepository<BroadcastSeason, Long> {
    @Query(value = "select * from tournament_broadcast_season where server = :server order by start_date desc nulls last, created_at desc, id desc", nativeQuery = true)
    List<BroadcastSeason> list(@Param("server") String server);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from BroadcastSeason s where s.id = :id")
    Optional<BroadcastSeason> findLocked(@Param("id") long id);
}

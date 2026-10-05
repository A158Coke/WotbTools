package com.wotb.web.tournament.repository;
import com.wotb.web.tournament.entity.TournamentEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TournamentEventRepository extends JpaRepository<TournamentEvent, Long> {
    List<TournamentEvent> findAllByOrderByYearDescIdDesc();
    boolean existsByYearAndRegionAndSeason(int year, String region, String season);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select e from TournamentEvent e where e.id = :id")
    Optional<TournamentEvent> findLocked(@Param("id") long id);
}

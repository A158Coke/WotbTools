package com.wotb.web.tournament.repository;
import com.wotb.web.tournament.entity.TournamentAudit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.List;
import java.util.Optional;

public interface TournamentAuditRepository extends JpaRepository<TournamentAudit, Long> {
    List<TournamentAudit> findByEventIdOrderByIdDesc(long eventId);
    @Query(value = "select * from tournament_audit where event_id = :eventId and action = 'CSV_IMPORTED' and after_state ->> 'idempotencyKey' = :key order by id desc limit 1", nativeQuery = true)
    Optional<TournamentAudit> findCsvImport(long eventId, String key);
    void deleteByEventId(long eventId);
}

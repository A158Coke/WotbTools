package com.wotb.web.tournament.repository;
import com.wotb.web.tournament.entity.TournamentAudit;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface TournamentAuditRepository extends JpaRepository<TournamentAudit, Long> {
    List<TournamentAudit> findByEventIdOrderByIdDesc(long eventId);
    void deleteByEventId(long eventId);
}

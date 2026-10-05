package com.wotb.web.tournament.repository;
import com.wotb.web.tournament.entity.TournamentEvidence;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface TournamentEvidenceRepository extends JpaRepository<TournamentEvidence, String> {
    List<TournamentEvidence> findByEventId(long eventId);
    Optional<TournamentEvidence> findByIdAndEventId(String id, long eventId);
    void deleteByEventId(long eventId);
}

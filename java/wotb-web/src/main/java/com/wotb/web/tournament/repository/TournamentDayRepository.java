package com.wotb.web.tournament.repository;
import com.wotb.web.tournament.entity.TournamentDay;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface TournamentDayRepository extends JpaRepository<TournamentDay, Long> {
    List<TournamentDay> findByEventIdOrderByRoundNumberAscDayNumberAsc(long eventId);
    Optional<TournamentDay> findByEventIdAndRoundNumberAndDayNumber(long eventId, int roundNumber, int dayNumber);
    void deleteByEventId(long eventId);
}

package com.wotb.web.tournament.repository;
import com.wotb.web.tournament.entity.TournamentRule;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface TournamentRuleRepository extends JpaRepository<TournamentRule, Long> {
    List<TournamentRule> findByEventIdOrderByRoundNumber(long eventId);
    Optional<TournamentRule> findByEventIdAndRoundNumber(long eventId, int roundNumber);
    void deleteByEventId(long eventId);
}

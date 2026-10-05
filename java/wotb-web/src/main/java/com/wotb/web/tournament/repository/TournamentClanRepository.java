package com.wotb.web.tournament.repository;
import com.wotb.web.tournament.entity.TournamentClan;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface TournamentClanRepository extends JpaRepository<TournamentClan, Long> {
    List<TournamentClan> findByEventIdOrderByClanTag(long eventId);
    boolean existsByEventIdAndClanTag(long eventId, String clanTag);
    void deleteByEventId(long eventId);
}

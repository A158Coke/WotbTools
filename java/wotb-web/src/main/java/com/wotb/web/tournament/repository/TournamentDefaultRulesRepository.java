package com.wotb.web.tournament.repository;

import com.wotb.web.tournament.entity.TournamentDefaultRules;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface TournamentDefaultRulesRepository extends JpaRepository<TournamentDefaultRules, Long> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select d from TournamentDefaultRules d where d.id = 1")
    TournamentDefaultRules findLocked();
}

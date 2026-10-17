package com.wotb.web.tournament.repository;

import com.wotb.web.tournament.entity.BroadcastCategory;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface BroadcastCategoryRepository extends JpaRepository<BroadcastCategory, Long> {
    List<BroadcastCategory> findBySeasonIdOrderByIdAsc(long seasonId);
    Optional<BroadcastCategory> findBySeasonIdAndType(long seasonId, String type);
    void deleteBySeasonId(long seasonId);
}

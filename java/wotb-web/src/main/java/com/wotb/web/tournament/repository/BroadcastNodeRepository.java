package com.wotb.web.tournament.repository;

import com.wotb.web.tournament.entity.BroadcastNode;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;

public interface BroadcastNodeRepository extends JpaRepository<BroadcastNode, Long> {
    List<BroadcastNode> findByCategoryIdOrderByRootKeyAscIdAsc(long categoryId);
    boolean existsByCategoryIdAndRootKey(long categoryId, int rootKey);
    @Query("select n from BroadcastNode n where n.categoryId in (select c.id from BroadcastCategory c where c.seasonId = :seasonId) order by n.id")
    List<BroadcastNode> findBySeasonId(@Param("seasonId") long seasonId);
}

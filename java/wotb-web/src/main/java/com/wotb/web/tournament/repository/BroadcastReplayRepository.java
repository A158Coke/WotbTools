package com.wotb.web.tournament.repository;

import com.wotb.web.tournament.entity.BroadcastReplay;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface BroadcastReplayRepository extends JpaRepository<BroadcastReplay, Long> {
    List<BroadcastReplay> findByNodeIdOrderByMatchDateAscIdAsc(long nodeId);
    long countByNodeId(long nodeId);
    boolean existsByCoverId(String coverId);
    void deleteByNodeId(long nodeId);
}

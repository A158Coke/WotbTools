package com.wotb.web.hundred.repository;

import com.wotb.web.hundred.entity.HundredBattleReplayEvidence;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface HundredBattleReplayEvidenceRepository extends JpaRepository<HundredBattleReplayEvidence, Long> {

    List<HundredBattleReplayEvidence> findBySubmissionIdOrderBySlotAsc(long submissionId);

    Optional<HundredBattleReplayEvidence> findBySubmissionIdAndId(long submissionId, long id);

    List<HundredBattleReplayEvidence> findBySubmissionId(long submissionId);

    long countBySha256(String sha256);

    void deleteBySubmissionId(long submissionId);
}

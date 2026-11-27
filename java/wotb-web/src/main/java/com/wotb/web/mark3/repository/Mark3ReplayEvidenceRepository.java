package com.wotb.web.mark3.repository;

import com.wotb.web.mark3.entity.Mark3ReplayEvidence;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface Mark3ReplayEvidenceRepository extends JpaRepository<Mark3ReplayEvidence, Long> {

    List<Mark3ReplayEvidence> findBySubmissionIdOrderBySlotAsc(long submissionId);

    Optional<Mark3ReplayEvidence> findBySubmissionIdAndId(long submissionId, long id);

    List<Mark3ReplayEvidence> findBySubmissionId(long submissionId);

    long countBySha256(String sha256);

    void deleteBySubmissionId(long submissionId);
}

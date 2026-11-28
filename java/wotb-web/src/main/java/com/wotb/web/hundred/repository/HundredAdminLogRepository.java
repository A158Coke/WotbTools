package com.wotb.web.hundred.repository;

import com.wotb.web.hundred.entity.HundredAdminLog;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface HundredAdminLogRepository extends JpaRepository<HundredAdminLog, Long> {

    List<HundredAdminLog> findBySubmissionIdOrderByIdAsc(long submissionId);
}

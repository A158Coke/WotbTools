package com.wotb.web.creator.repository;

import com.wotb.web.creator.entity.CreatorLevel;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface CreatorLevelRepository extends JpaRepository<CreatorLevel, Long> {
    List<CreatorLevel> findAllByOrderByIdAsc();
}

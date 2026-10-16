package com.wotb.web.creator.repository;

import com.wotb.web.creator.entity.CreatorSettings;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface CreatorSettingsRepository extends JpaRepository<CreatorSettings, Long> {
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select s from CreatorSettings s where s.id = 1")
    CreatorSettings findShared();

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from CreatorSettings s where s.id = 1")
    CreatorSettings findExclusive();
}

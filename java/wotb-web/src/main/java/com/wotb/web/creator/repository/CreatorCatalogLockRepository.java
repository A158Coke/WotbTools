package com.wotb.web.creator.repository;

import com.wotb.web.creator.entity.CreatorCatalogLock;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface CreatorCatalogLockRepository extends JpaRepository<CreatorCatalogLock, Long> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from CreatorCatalogLock c where c.id = 1")
    CreatorCatalogLock findExclusive();
}

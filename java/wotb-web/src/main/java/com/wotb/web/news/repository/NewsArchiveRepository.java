package com.wotb.web.news.repository;

import com.wotb.web.news.entity.NewsArchive;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface NewsArchiveRepository extends JpaRepository<NewsArchive, Long> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from NewsArchive a where a.id = :id")
    Optional<NewsArchive> findLocked(@Param("id") long id);
    @Query("select a from NewsArchive a where (:admin = true or a.status = 'PUBLISHED') and (:version is null or a.version = :version) order by a.createdAt desc, a.id desc")
    Page<NewsArchive> browse(@Param("admin") boolean admin, @Param("version") String version, Pageable page);
    @Query(value = "select * from news_archive where status = 'PREPARING' and attempt_token is null order by id limit 1 for update skip locked", nativeQuery = true)
    Optional<NewsArchive> nextPending();
    @Query("select a.id from NewsArchive a where a.status = 'PREPARING' and a.leaseUntil <= :now")
    List<Long> expired(@Param("now") Instant now);
    @Query(value = "select count(*) from news_archive_image r join news_image i on i.id = r.image_id where r.archive_id = :id and i.status = 'READY'", nativeQuery = true)
    long readyImageCount(@Param("id") long id);
    @Modifying
    @Query(value = "update news_image i set unreferenced_at = :now where exists (select 1 from news_archive_image r where r.image_id=i.id and r.archive_id=:id) and not exists (select 1 from news_archive_image r where r.image_id=i.id and r.archive_id<>:id)", nativeQuery = true)
    int markDetachedImages(@Param("id") long id, @Param("now") Instant now);
}

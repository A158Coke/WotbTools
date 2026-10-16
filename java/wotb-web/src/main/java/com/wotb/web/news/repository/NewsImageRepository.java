package com.wotb.web.news.repository;

import com.wotb.web.news.entity.NewsImage;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface NewsImageRepository extends JpaRepository<NewsImage, String> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select i from NewsImage i where i.id = :id")
    Optional<NewsImage> findLocked(@Param("id") String id);

    Optional<NewsImage> findByArchiveIdAndSourceImageId(long archiveId, String sourceImageId);

    @Modifying
    @Query(value = "insert into news_archive_image(archive_id,image_id) values(:archiveId,:id) on conflict do nothing", nativeQuery = true)
    void attach(@Param("archiveId") long archiveId, @Param("id") String id);

    @Query(value = "select exists(select 1 from news_archive_image where image_id=:id)", nativeQuery = true)
    boolean referenced(@Param("id") String id);

    @Query(value = "select exists(select 1 from news_archive_image r join news_archive a on a.id=r.archive_id where r.image_id=:id and a.status='PUBLISHED')", nativeQuery = true)
    boolean publiclyReferenced(@Param("id") String id);

    @Query(value = "select i.id from news_image i where coalesce(i.unreferenced_at,i.created_at)<:cutoff and not exists(select 1 from news_archive_image r where r.image_id=i.id) order by i.created_at limit 100", nativeQuery = true)
    List<String> expired(@Param("cutoff") Instant cutoff);
}

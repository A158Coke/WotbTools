package com.wotb.web.news.repository;

import com.wotb.web.news.entity.NewsCategory;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Optional;

public interface NewsCategoryRepository extends JpaRepository<NewsCategory, Long> {
    List<NewsCategory> findAllByOrderByIdAsc();
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from NewsCategory c where c.id = :id")
    Optional<NewsCategory> findLocked(@Param("id") long id);
    @Query(value = "select exists(select 1 from news_archive_category where category_id = :id)", nativeQuery = true)
    boolean referenced(@Param("id") long id);
}

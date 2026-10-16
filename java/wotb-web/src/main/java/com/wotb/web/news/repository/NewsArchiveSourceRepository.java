package com.wotb.web.news.repository;

import com.wotb.web.news.entity.NewsArchiveSource;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface NewsArchiveSourceRepository extends JpaRepository<NewsArchiveSource, Long> {
    List<NewsArchiveSource> findByArchiveIdOrderByPositionAsc(long archiveId);
}

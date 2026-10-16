package com.wotb.web.news.entity;

import com.wotb.web.news.dto.NewsDtos;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.util.Map;

/** Frozen selected content and its image origins; never reads a newer source cache. */
@Entity
@Table(name = "news_archive_source")
public class NewsArchiveSource {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) public Long id;
    @Column(name = "archive_id", nullable = false) public long archiveId;
    @Column(nullable = false) public int position;
    @JdbcTypeCode(SqlTypes.JSON) @Column(nullable = false, columnDefinition = "jsonb")
    public NewsDtos.Article article;
    @JdbcTypeCode(SqlTypes.JSON) @Column(name = "image_sources", nullable = false, columnDefinition = "jsonb")
    public Map<String, String> imageSources;
}

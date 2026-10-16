package com.wotb.web.news.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.util.List;

@Entity
@Table(name = "news_receipt")
public class NewsReceipt {
    @Id @Column(length = 512) public String id;
    @Column(name = "payload_hash", nullable = false, length = 64) public String payloadHash;
    @JdbcTypeCode(SqlTypes.JSON) @Column(name = "archive_ids", nullable = false, columnDefinition = "jsonb")
    public List<Long> archiveIds;
}

package com.wotb.web.news.repository;

import com.wotb.web.news.entity.NewsReceipt;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.Optional;

public interface NewsReceiptRepository extends JpaRepository<NewsReceipt, String> {
    @Modifying
    @Query(value = "insert into news_receipt(id,payload_hash,archive_ids) values (:id,:hash,'[]'::jsonb) on conflict (id) do nothing", nativeQuery = true)
    int reserve(@Param("id") String id, @Param("hash") String hash);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from NewsReceipt r where r.id = :id")
    Optional<NewsReceipt> findLocked(@Param("id") String id);
}

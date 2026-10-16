package com.wotb.web.creator.repository;

import com.wotb.web.creator.entity.CreatorFavorite;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Optional;

public interface CreatorFavoriteRepository extends JpaRepository<CreatorFavorite, Long> {
    Optional<CreatorFavorite> findByCreatorIdAndSubject(long creatorId, String subject);
    List<CreatorFavorite> findAllBySubjectOrderByCreatorIdAsc(String subject);

    @Query("select f.creatorId from CreatorFavorite f where f.subject = :subject and f.active = true order by f.creatorId")
    List<Long> activeCreatorIds(@Param("subject") String subject);
}

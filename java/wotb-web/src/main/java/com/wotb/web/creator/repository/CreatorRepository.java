package com.wotb.web.creator.repository;

import com.wotb.web.creator.entity.Creator;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Optional;

public interface CreatorRepository extends JpaRepository<Creator, Long> {
    @EntityGraph(attributePaths = "categoryIds")
    @Query("select c from Creator c where (:categoryId is null or :categoryId member of c.categoryIds) order by c.stars desc, c.createdAt desc, c.id desc")
    List<Creator> publicList(@Param("categoryId") Long categoryId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from Creator c where c.id = :id")
    Optional<Creator> findLocked(@Param("id") long id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from Creator c where :categoryId member of c.categoryIds order by c.id")
    List<Creator> findCategoryMembersLocked(@Param("categoryId") long categoryId);

    boolean existsByLevelId(long levelId);
    boolean existsByBilibiliUid(String bilibiliUid);
    boolean existsByBilibiliUidAndIdNot(String bilibiliUid, long id);
    boolean existsByAvatarId(String avatarId);

    @Query(value = """
            select exists (
              select 1 from creator_category_link selected
              where selected.category_id = :categoryId
                and not exists (select 1 from creator_category_link other
                    where other.creator_id = selected.creator_id and other.category_id <> :categoryId)
            )
            """, nativeQuery = true)
    boolean wouldOrphanCreator(@Param("categoryId") long categoryId);

    @Modifying(flushAutomatically = true)
    @Query(value = "delete from creator_category_link where category_id = :categoryId", nativeQuery = true)
    void removeCategoryLinks(@Param("categoryId") long categoryId);
}

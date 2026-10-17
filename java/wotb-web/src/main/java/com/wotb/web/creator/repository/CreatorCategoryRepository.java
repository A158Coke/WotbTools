package com.wotb.web.creator.repository;

import com.wotb.web.creator.entity.CreatorCategory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.List;

public interface CreatorCategoryRepository extends JpaRepository<CreatorCategory, Long> {
    List<CreatorCategory> findAllByTypeOrderByIdAsc(String type);

    @Query(value = """
            select c.* from creator_category c
            where exists (select 1 from creator_category_link l where l.category_id = c.id)
            order by c.id
            """, nativeQuery = true)
    List<CreatorCategory> findPopulatedByOrderByIdAsc();
}

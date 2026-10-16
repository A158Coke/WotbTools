package com.wotb.web.creator.repository;

import com.wotb.web.creator.entity.CreatorCategory;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface CreatorCategoryRepository extends JpaRepository<CreatorCategory, Long> {
    List<CreatorCategory> findAllByOrderByIdAsc();
}

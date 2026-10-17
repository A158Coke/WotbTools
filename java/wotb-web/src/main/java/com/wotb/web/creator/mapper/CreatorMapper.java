package com.wotb.web.creator.mapper;

import com.wotb.web.creator.dto.CreatorDtos;
import com.wotb.web.creator.dto.RecommendationDtos;
import com.wotb.web.config.ApiPaths;
import com.wotb.web.creator.entity.Creator;
import com.wotb.web.creator.entity.CreatorCategory;
import com.wotb.web.creator.entity.CreatorLevel;
import com.wotb.web.util.Mapper;
import org.springframework.stereotype.Component;
import java.util.Map;

@Component
public class CreatorMapper implements Mapper<Creator, RecommendationDtos.Detail> {
    @Override
    public RecommendationDtos.Detail toDto(final Creator creator) {
        return new RecommendationDtos.Detail(creator.id, creator.version, creator.type, creator.externalId,
                creator.name, creator.description, creator.categoryIds.stream().sorted().toList(),
                creator.levelId, creator.stars, avatarUrl(creator.avatarId));
    }
    public RecommendationDtos.Card card(final Creator creator, final Map<Long, RecommendationDtos.Category> categories,
                                        final Map<Long, CreatorDtos.Level> levels) {
        return new RecommendationDtos.Card(creator.id, creator.version, creator.type, creator.externalId,
                creator.name, creator.description,
                ("VIDEO".equals(creator.type) ? "https://www.bilibili.com/video/" : "https://space.bilibili.com/") + creator.externalId,
                avatarUrl(creator.avatarId), creator.categoryIds.stream().sorted().map(categories::get).toList(),
                creator.levelId == null ? null : levels.get(creator.levelId), creator.stars * 2, creator.createdAt);
    }
    public RecommendationDtos.Category category(final CreatorCategory category) {
        return new RecommendationDtos.Category(category.id, category.name, category.type);
    }
    public CreatorDtos.Level level(final CreatorLevel level) { return new CreatorDtos.Level(level.id, level.name); }
    public static String avatarUrl(final String id) { return id == null ? null : ApiPaths.CREATORS + "/avatars/" + id; }

    // Explicit legacy wire adapters: the service fixes their domain type to UP before mapping.
    public CreatorDtos.Detail legacy(final RecommendationDtos.Detail value) {
        return new CreatorDtos.Detail(value.id(), value.version(), value.externalId(), value.name(), value.description(),
                value.categoryIds(), value.levelId(), value.stars(), value.imageUrl());
    }
    public CreatorDtos.Card legacy(final RecommendationDtos.Card value) {
        return new CreatorDtos.Card(value.id(), value.version(), value.externalId(), value.name(), value.description(),
                value.targetUrl(), value.imageUrl(), value.categories().stream().map(this::legacy).toList(),
                value.level(), value.score(), value.createdAt());
    }
    public CreatorDtos.Category legacy(final RecommendationDtos.Category value) {
        return new CreatorDtos.Category(value.id(), value.name());
    }
    public RecommendationDtos.SaveRequest request(final CreatorDtos.SaveRequest value) {
        return value == null ? null : new RecommendationDtos.SaveRequest("UP", value.bilibiliUid(), value.name(),
                value.description(), value.categoryIds(), value.levelId(), value.stars(), value.avatarAction(), value.expectedVersion());
    }
}

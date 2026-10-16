package com.wotb.web.creator.mapper;

import com.wotb.web.creator.dto.CreatorDtos;
import com.wotb.web.config.ApiPaths;
import com.wotb.web.creator.entity.Creator;
import com.wotb.web.creator.entity.CreatorCategory;
import com.wotb.web.creator.entity.CreatorLevel;
import com.wotb.web.util.Mapper;
import org.springframework.stereotype.Component;
import java.util.Map;

@Component
public class CreatorMapper implements Mapper<Creator, CreatorDtos.Detail> {
    @Override
    public CreatorDtos.Detail toDto(final Creator creator) {
        return new CreatorDtos.Detail(creator.id, creator.name, creator.description, creator.homepageUrl,
                creator.categoryIds.stream().sorted().toList(), creator.levelId, creator.baseStars,
                creator.avatarId, avatarUrl(creator.avatarId));
    }
    public CreatorDtos.Card card(final Creator creator, final Map<Long, CreatorDtos.Category> categories,
                                 final Map<Long, CreatorDtos.Level> levels) {
        return new CreatorDtos.Card(creator.id, creator.name, creator.description, creator.homepageUrl, avatarUrl(creator.avatarId),
                creator.categoryIds.stream().sorted().map(categories::get).toList(),
                creator.levelId == null ? null : levels.get(creator.levelId), score(creator),
                creator.favoriteCount, creator.createdAt);
    }
    public CreatorDtos.Category category(final CreatorCategory category) {
        return new CreatorDtos.Category(category.id, category.name);
    }
    public CreatorDtos.Level level(final CreatorLevel level) {
        return new CreatorDtos.Level(level.id, level.name);
    }
    public static int score(final Creator creator) { return Math.min(10, creator.baseStars * 2 + creator.rewardPoints); }
    public static String avatarUrl(final String id) { return id == null ? null : ApiPaths.CREATORS + "/avatars/" + id; }
}

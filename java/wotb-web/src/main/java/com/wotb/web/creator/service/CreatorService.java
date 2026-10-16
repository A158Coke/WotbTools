package com.wotb.web.creator.service;

import com.wotb.web.creator.dto.CreatorDtos;
import com.wotb.web.creator.entity.Creator;
import com.wotb.web.creator.entity.CreatorCategory;
import com.wotb.web.creator.entity.CreatorFavorite;
import com.wotb.web.creator.entity.CreatorLevel;
import com.wotb.web.creator.entity.CreatorSettings;
import com.wotb.web.creator.mapper.CreatorMapper;
import com.wotb.web.creator.repository.CreatorCategoryRepository;
import com.wotb.web.creator.repository.CreatorFavoriteRepository;
import com.wotb.web.creator.repository.CreatorLevelRepository;
import com.wotb.web.creator.repository.CreatorRepository;
import com.wotb.web.creator.repository.CreatorSettingsRepository;
import com.wotb.web.user.service.AdminUserLogPersister;
import com.wotb.web.util.JwtUtil;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import java.net.URI;
import java.net.URISyntaxException;
import java.time.Instant;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Lock order for all writes: settings (shared for favorites) -> creator -> favorite history. */
@Service
@Transactional
public class CreatorService {
    private static final int DEFAULT_THRESHOLD = 200;
    private final CreatorRepository creators;
    private final CreatorCategoryRepository categories;
    private final CreatorLevelRepository levels;
    private final CreatorSettingsRepository settings;
    private final CreatorFavoriteRepository favorites;
    private final CreatorMapper mapper;
    private final CreatorAvatarService avatars;
    private final AdminUserLogPersister accountAudit;

    public CreatorService(final CreatorRepository creators, final CreatorCategoryRepository categories,
                          final CreatorLevelRepository levels, final CreatorSettingsRepository settings,
                          final CreatorFavoriteRepository favorites, final CreatorMapper mapper,
                          final CreatorAvatarService avatars, final AdminUserLogPersister accountAudit) {
        this.creators = creators;
        this.categories = categories;
        this.levels = levels;
        this.settings = settings;
        this.favorites = favorites;
        this.mapper = mapper;
        this.avatars = avatars;
        this.accountAudit = accountAudit;
    }

    @Transactional(readOnly = true)
    public List<CreatorDtos.Category> categories() {
        return categories.findAllByOrderByIdAsc().stream().map(mapper::category).toList();
    }
    @Transactional(readOnly = true)
    public List<CreatorDtos.Level> levels() {
        return levels.findAllByOrderByIdAsc().stream().map(mapper::level).toList();
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public List<CreatorDtos.Card> list(final Long categoryId) {
        if (categoryId != null && categoryId <= 0) { throw invalid(); }
        final List<Creator> rows = creators.publicList(categoryId);
        final Map<Long, CreatorDtos.Category> categoryMap = categoryMap();
        final Map<Long, CreatorDtos.Level> levelMap = levelMap();
        return rows.stream().map(creator -> mapper.card(creator, categoryMap, levelMap)).toList();
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public CreatorDtos.Detail detail(final long id) { return mapper.toDto(required(id)); }

    public CreatorDtos.Detail create(final CreatorDtos.SaveRequest request) {
        exclusiveSettings();
        final Creator creator = new Creator();
        assign(creator, request);
        if (request.avatarId() != null) { avatars.attach(request.avatarId()); }
        creator.avatarId = request.avatarId();
        creator.createdAt = Instant.now();
        return mapper.toDto(creators.saveAndFlush(creator));
    }
    public CreatorDtos.Detail update(final long id, final CreatorDtos.SaveRequest request) {
        exclusiveSettings();
        final Creator creator = locked(id);
        assign(creator, request);
        final String previous = creator.avatarId;
        final boolean avatarChanged = !Objects.equals(previous, request.avatarId());
        if (avatarChanged && request.avatarId() != null) { avatars.attach(request.avatarId()); }
        creator.avatarId = request.avatarId();
        creators.flush();
        if (avatarChanged) { avatars.detach(previous); }
        return mapper.toDto(creator);
    }
    public void delete(final long id) {
        exclusiveSettings();
        final Creator creator = locked(id);
        final String previous = creator.avatarId;
        creators.delete(creator);
        creators.flush();
        avatars.detach(previous);
    }
    public CreatorDtos.Category addCategory(final CreatorDtos.DictionaryRequest request) {
        exclusiveSettings();
        final CreatorCategory category = new CreatorCategory();
        category.name = name(request == null ? null : request.name());
        return mapper.category(categories.saveAndFlush(category));
    }
    public void deleteCategory(final long id) {
        exclusiveSettings();
        final CreatorCategory category = categories.findById(id).orElseThrow(CreatorService::notFound);
        if (creators.wouldOrphanCreator(id)) { throw error(ApiErrorCode.CREATOR_CATEGORY_IN_USE); }
        creators.removeCategoryLinks(id);
        categories.delete(category);
        categories.flush();
    }
    public CreatorDtos.Level addLevel(final CreatorDtos.DictionaryRequest request) {
        exclusiveSettings();
        final CreatorLevel level = new CreatorLevel();
        level.name = name(request == null ? null : request.name());
        return mapper.level(levels.saveAndFlush(level));
    }
    public void deleteLevel(final long id) {
        exclusiveSettings();
        final CreatorLevel level = levels.findById(id).orElseThrow(CreatorService::notFound);
        if (creators.existsByLevelId(id)) { throw error(ApiErrorCode.CREATOR_LEVEL_IN_USE); }
        levels.delete(level);
        levels.flush();
    }
    @Transactional(readOnly = true)
    public CreatorDtos.Settings settings() {
        return configuration(settings.findById(1L).orElseThrow());
    }
    public CreatorDtos.Settings configure(final CreatorDtos.SettingsRequest request) {
        final CreatorSettings slot = exclusiveSettings();
        if (request == null || request.favoriteThreshold() <= 0) { throw invalid(); }
        slot.favoriteThreshold = request.favoriteThreshold();
        return configuration(slot);
    }
    @Transactional(readOnly = true)
    public CreatorDtos.Favorites favorites(final String subject) {
        validateSubject(subject);
        return new CreatorDtos.Favorites(favorites.activeCreatorIds(subject));
    }
    public CreatorDtos.FavoriteResult favorite(final String subject, final long id, final boolean desired) {
        validateSubject(subject);
        final CreatorSettings configuration = settings.findShared();
        accountAudit.requireAccountWritable(subject);
        final Creator creator = locked(id);
        CreatorFavorite favorite = favorites.findByCreatorIdAndSubject(id, subject).orElse(null);
        final boolean first = favorite == null;
        if (first && desired) {
            favorite = new CreatorFavorite();
            favorite.creatorId = id;
            favorite.subject = subject;
            favorite.active = false;
            favorites.save(favorite);
        }
        if (favorite != null && favorite.active != desired) {
            favorite.active = desired;
            creator.favoriteCount += desired ? 1 : -1;
            if (desired && first && CreatorMapper.score(creator) < 10) {
                creator.cycleCount++;
                final int threshold = threshold(configuration);
                final int reward = (int) Math.min(10 - CreatorMapper.score(creator), creator.cycleCount / threshold);
                creator.rewardPoints += reward;
                creator.cycleCount -= (long) reward * threshold;
            }
        }
        creators.flush();
        return new CreatorDtos.FavoriteResult(mapper.card(creator, categoryMap(), levelMap()), desired);
    }

    /** Remove account identity while preserving earned creator rewards and referenced public images. */
    public void removeDataForAccountDeletion(final String subject) {
        validateSubject(subject);
        // Block first favorites too: locking existing history alone cannot protect absent rows.
        settings.findExclusive();
        final List<CreatorFavorite> history = favorites.findAllBySubjectOrderByCreatorIdAsc(subject);
        for (final CreatorFavorite favorite : history) {
            final Creator creator = locked(favorite.creatorId);
            if (favorite.active) { creator.favoriteCount--; }
        }
        favorites.deleteAll(history);
        favorites.flush();
        avatars.removeOwnerForAccountDeletion(subject);
    }

    private void assign(final Creator creator, final CreatorDtos.SaveRequest request) {
        if (request == null || request.baseStars() < 1 || request.baseStars() > 5
                || request.categoryIds() == null || request.categoryIds().isEmpty()
                || request.categoryIds().stream().anyMatch(id -> id == null || id <= 0)
                || new HashSet<>(request.categoryIds()).size() != request.categoryIds().size()
                || (request.levelId() != null && request.levelId() <= 0)) { throw invalid(); }
        final String cleanName = name(request.name());
        final String homepage = homepage(request.homepageUrl());
        if (request.description() != null && request.description().length() > 2000) { throw invalid(); }
        if (categories.findAllById(request.categoryIds()).size() != request.categoryIds().size()
                || (request.levelId() != null && !levels.existsById(request.levelId()))) {
            throw error(ApiErrorCode.CREATOR_CONFIG_CONFLICT);
        }
        creator.name = cleanName;
        creator.description = StringUtils.hasText(request.description()) ? request.description().trim() : null;
        creator.homepageUrl = homepage;
        creator.categoryIds.clear();
        creator.categoryIds.addAll(new LinkedHashSet<>(request.categoryIds()));
        creator.levelId = request.levelId();
        creator.baseStars = request.baseStars();
    }
    private Creator required(final long id) { return creators.findById(id).orElseThrow(CreatorService::notFound); }
    private CreatorSettings exclusiveSettings() {
        final CreatorSettings slot = settings.findExclusive();
        final String actor = JwtUtil.currentUserId();
        if (actor != null) { accountAudit.requireAccountWritable(actor); }
        return slot;
    }
    private Creator locked(final long id) { return creators.findLocked(id).orElseThrow(CreatorService::notFound); }
    private Map<Long, CreatorDtos.Category> categoryMap() {
        return categories.findAllByOrderByIdAsc().stream().map(mapper::category)
                .collect(Collectors.toMap(CreatorDtos.Category::id, Function.identity()));
    }
    private Map<Long, CreatorDtos.Level> levelMap() {
        return levels.findAllByOrderByIdAsc().stream().map(mapper::level)
                .collect(Collectors.toMap(CreatorDtos.Level::id, Function.identity()));
    }
    private static int threshold(final CreatorSettings configuration) {
        return configuration.favoriteThreshold == null ? DEFAULT_THRESHOLD : configuration.favoriteThreshold;
    }
    private CreatorDtos.Settings configuration(final CreatorSettings configuration) {
        return new CreatorDtos.Settings(threshold(configuration), avatars.configured());
    }
    private static String name(final String raw) {
        if (!StringUtils.hasText(raw) || raw.trim().length() > 100) { throw invalid(); }
        return raw.trim();
    }
    private static String homepage(final String raw) {
        if (!StringUtils.hasText(raw) || raw.length() > 300) { throw invalid(); }
        try {
            final URI uri = new URI(raw.trim());
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !"space.bilibili.com".equalsIgnoreCase(uri.getHost())
                    || uri.getRawUserInfo() != null || uri.getPort() != -1 || uri.getRawFragment() != null
                    || uri.getRawPath() == null || !uri.getRawPath().matches("/[1-9][0-9]*/?")) { throw invalid(); }
            return "https://space.bilibili.com/" + uri.getRawPath().substring(1).replaceAll("/$", "");
        } catch (final URISyntaxException e) { throw invalid(); }
    }
    private static void validateSubject(final String subject) {
        if (!StringUtils.hasText(subject) || subject.length() > 64) { throw error(ApiErrorCode.AUTH_UNAUTHENTICATED); }
    }
    private static ApiException invalid() { return error(ApiErrorCode.CREATOR_INVALID_REQUEST); }
    private static ApiException notFound() { return error(ApiErrorCode.CREATOR_NOT_FOUND); }
    private static ApiException error(final ApiErrorCode code) { return new ApiException(code); }
}

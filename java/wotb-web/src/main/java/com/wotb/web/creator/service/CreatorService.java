package com.wotb.web.creator.service;

import com.wotb.web.creator.dto.RecommendationDtos;
import com.wotb.web.creator.entity.Creator;
import com.wotb.web.creator.entity.CreatorCategory;
import com.wotb.web.creator.entity.CreatorLevel;
import com.wotb.web.creator.mapper.CreatorMapper;
import com.wotb.web.creator.repository.CreatorCategoryRepository;
import com.wotb.web.creator.repository.CreatorLevelRepository;
import com.wotb.web.creator.repository.CreatorRepository;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import java.time.Instant;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/** Catalog write order: catalog -> creator -> avatar. Image I/O precedes the catalog transaction. */
@Service
@Transactional
public class CreatorService {
    // OpenAPI/Ajv uses ECMAScript \s: ASCII whitespace, Unicode Zs, LS, PS and BOM.
    // Java trim/strip and Unicode regex \s each accept a different set.
    private static final String INPUT_WHITESPACE = "[\\s\\p{Zs}\\u2028\\u2029\\uFEFF]*";
    private static final Pattern UID_INPUT = Pattern.compile(INPUT_WHITESPACE + "([0-9]{1,20})" + INPUT_WHITESPACE);
    private static final Pattern VIDEO_INPUT = Pattern.compile(INPUT_WHITESPACE + "(BV[A-Za-z0-9]{10})" + INPUT_WHITESPACE);
    private final CreatorRepository creators;
    private final CreatorCategoryRepository categories;
    private final CreatorLevelRepository levels;
    private final CreatorMapper mapper;
    private final CreatorAvatarService avatars;
    private final TransactionTemplate writes;

    public CreatorService(final CreatorRepository creators, final CreatorCategoryRepository categories,
                          final CreatorLevelRepository levels,
                          final CreatorMapper mapper, final CreatorAvatarService avatars,
                          final PlatformTransactionManager transactions) {
        this.creators = creators; this.categories = categories; this.levels = levels;
        this.mapper = mapper; this.avatars = avatars;
        this.writes = new TransactionTemplate(transactions);
    }
    @Transactional(readOnly = true)
    public List<RecommendationDtos.Category> publicRecommendationCategories() {
        return categories.findPopulatedByOrderByIdAsc().stream().map(mapper::category).toList();
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public RecommendationDtos.Metadata recommendationMetadata(final String type) {
        requireType(type);
        return new RecommendationDtos.Metadata(type, categoryRows(type), "UP".equals(type)
                ? levels.findAllByOrderByIdAsc().stream().map(mapper::level).toList() : List.of(), avatars.configured());
    }
    private List<RecommendationDtos.Category> categoryRows(final String type) {
        return categories.findAllByTypeOrderByIdAsc(type).stream().map(mapper::category).toList();
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public List<RecommendationDtos.Card> recommendations(final String type, final Long categoryId) {
        requireType(type);
        if (categoryId != null && categoryId <= 0) { throw invalid(); }
        if (categoryId != null) {
            categories.findById(categoryId).ifPresent(category -> {
                if (!type.equals(category.type)) { throw notFound(); }
            });
        }
        final List<Creator> rows = creators.publicList(type, categoryId);
        final Map<Long, RecommendationDtos.Category> categoryMap = categoryRows(type).stream()
                .collect(Collectors.toMap(RecommendationDtos.Category::id, Function.identity()));
        final Map<Long, RecommendationDtos.Level> levelMap = levels.findAllByOrderByIdAsc().stream().map(mapper::level)
                .collect(Collectors.toMap(RecommendationDtos.Level::id, Function.identity()));
        return rows.stream().map(creator -> mapper.card(creator, categoryMap, levelMap)).toList();
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public RecommendationDtos.Detail recommendationDetail(final String type, final long id) {
        requireType(type);
        return mapper.toDto(creators.findById(id).filter(creator -> type.equals(creator.type)).orElseThrow(CreatorService::notFound));
    }
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public RecommendationDtos.Detail createRecommendation(final RecommendationDtos.SaveRequest request, final MultipartFile image) {
        return save(null, request, image);
    }
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public RecommendationDtos.Detail updateRecommendation(final long id, final RecommendationDtos.SaveRequest request, final MultipartFile image) {
        if (id <= 0) { throw invalid(); }
        return save(id, request, image);
    }
    private RecommendationDtos.Detail save(final Long id, final RecommendationDtos.SaveRequest request, final MultipartFile avatar) {
        validate(request, avatar);
        if ((id == null && request.expectedVersion() != null)
                || (id != null && (request.expectedVersion() == null || request.expectedVersion() < 0))) { throw invalid(); }
        final String externalId = externalId(request.type(), request.externalId());
        // The committed, site-owned upload remains discoverable if the following catalog transaction fails.
        final String uploaded = "REPLACE".equals(request.imageAction()) ? avatars.upload(avatar) : null;
        return writes.execute(tx -> {
            creators.lockCatalog();
            final Creator creator = id == null ? new Creator() : locked(request.type(), id);
            if (id != null) { requireVersion(creator, request.expectedVersion()); }
            final boolean duplicate = id == null ? creators.existsByTypeAndExternalId(request.type(), externalId)
                    : creators.existsByTypeAndExternalIdAndIdNot(request.type(), externalId, id);
            if (duplicate) { throw error("UP".equals(request.type()) ? ApiErrorCode.CREATOR_UID_ALREADY_EXISTS
                    : ApiErrorCode.RECOMMENDATION_ID_ALREADY_EXISTS); }
            final List<CreatorCategory> selected = categories.findAllById(request.categoryIds());
            if (selected.stream().anyMatch(category -> !request.type().equals(category.type))) { throw notFound(); }
            if (selected.size() != request.categoryIds().size()
                    || (request.levelId() != null && !levels.existsById(request.levelId()))) {
                throw error(ApiErrorCode.CREATOR_CONFIG_CONFLICT);
            }
            creator.type = request.type(); creator.externalId = externalId; creator.name = name(request.name());
            creator.description = StringUtils.hasText(request.description()) ? request.description().trim() : null;
            creator.categoryIds.clear(); creator.categoryIds.addAll(new LinkedHashSet<>(request.categoryIds()));
            creator.levelId = request.levelId(); creator.stars = request.stars();
            if (id == null) { creator.createdAt = Instant.now(); }
            else { creator.version++; }
            final String previous = creator.avatarId;
            if ("REPLACE".equals(request.imageAction())) { avatars.attach(uploaded); creator.avatarId = uploaded; }
            else if ("REMOVE".equals(request.imageAction())) { creator.avatarId = null; }
            creators.saveAndFlush(creator);
            if (!Objects.equals(previous, creator.avatarId)) { avatars.detach(previous); }
            return mapper.toDto(creator);
        });
    }
    public void deleteRecommendation(final String type, final long id, final long expectedVersion) {
        requireType(type);
        if (id <= 0 || expectedVersion < 0) { throw invalid(); }
        creators.lockCatalog();
        final Creator creator = locked(type, id);
        requireVersion(creator, expectedVersion);
        final String previous = creator.avatarId;
        creators.delete(creator); creators.flush(); avatars.detach(previous);
    }
    public RecommendationDtos.Category addRecommendationCategory(final RecommendationDtos.CategoryRequest request) {
        if (request == null) { throw invalid(); }
        requireType(request.type());
        creators.lockCatalog();
        final CreatorCategory category = new CreatorCategory();
        category.type = request.type(); category.name = name(request.name());
        return mapper.category(categories.saveAndFlush(category));
    }
    public void deleteRecommendationCategory(final String type, final long id) {
        requireType(type);
        creators.lockCatalog();
        final CreatorCategory category = categories.findById(id).filter(row -> type.equals(row.type)).orElseThrow(CreatorService::notFound);
        if (creators.wouldOrphanCreator(id)) { throw error(ApiErrorCode.CREATOR_CATEGORY_IN_USE); }
        for (final Creator creator : creators.findCategoryMembersLocked(id)) { creator.version++; }
        creators.removeCategoryLinks(id); categories.delete(category); categories.flush();
    }
    public RecommendationDtos.Level addLevel(final RecommendationDtos.DictionaryRequest request) {
        creators.lockCatalog();
        final CreatorLevel level = new CreatorLevel(); level.name = name(request == null ? null : request.name());
        return mapper.level(levels.saveAndFlush(level));
    }
    public void deleteLevel(final long id) {
        creators.lockCatalog();
        final CreatorLevel level = levels.findById(id).orElseThrow(CreatorService::notFound);
        if (creators.existsByLevelId(id)) { throw error(ApiErrorCode.CREATOR_LEVEL_IN_USE); }
        levels.delete(level); levels.flush();
    }
    private static void requireVersion(final Creator creator, final long expectedVersion) {
        if (creator.version != expectedVersion) { throw error(ApiErrorCode.CREATOR_CONFIG_CONFLICT); }
    }
    private Creator locked(final String type, final long id) {
        return creators.findLocked(id).filter(creator -> type.equals(creator.type)).orElseThrow(CreatorService::notFound);
    }
    private static void validate(final RecommendationDtos.SaveRequest request, final MultipartFile avatar) {
        if (request == null || request.stars() < 1 || request.stars() > 5
                || request.categoryIds() == null || request.categoryIds().isEmpty()
                || request.categoryIds().stream().anyMatch(id -> id == null || id <= 0)
                || new HashSet<>(request.categoryIds()).size() != request.categoryIds().size()
                || (request.levelId() != null && request.levelId() <= 0)
                || request.imageAction() == null || !List.of("KEEP", "REPLACE", "REMOVE").contains(request.imageAction())
                || ("REPLACE".equals(request.imageAction()) != (avatar != null))
                || (request.description() != null && request.description().codePointCount(0, request.description().length()) > 2000)) { throw invalid(); }
        requireType(request.type());
        if ("VIDEO".equals(request.type()) && request.levelId() != null) { throw invalid(); }
        name(request.name()); externalId(request.type(), request.externalId());
    }
    private static String name(final String raw) {
        if (!StringUtils.hasText(raw)) { throw invalid(); }
        final String trimmed = raw.trim();
        if (trimmed.codePointCount(0, trimmed.length()) > 100) { throw invalid(); }
        return trimmed;
    }
    private static void requireType(final String type) {
        if (!"UP".equals(type) && !"VIDEO".equals(type)) { throw invalid(); }
    }
    private static String externalId(final String type, final String raw) {
        if ("UP".equals(type)) { return uid(raw); }
        if (raw == null) { throw invalid(); }
        final var match = VIDEO_INPUT.matcher(raw);
        if (!match.matches()) { throw invalid(); }
        return match.group(1);
    }
    private static String uid(final String raw) {
        if (raw == null) { throw invalid(); }
        final var match = UID_INPUT.matcher(raw);
        if (!match.matches()) { throw invalid(); }
        final String normalized = match.group(1).replaceFirst("^0+", "");
        if (normalized.isEmpty()) { throw invalid(); }
        return normalized;
    }
    private static ApiException invalid() { return error(ApiErrorCode.CREATOR_INVALID_REQUEST); }
    private static ApiException notFound() { return error(ApiErrorCode.CREATOR_NOT_FOUND); }
    private static ApiException error(final ApiErrorCode code) { return new ApiException(code); }
}

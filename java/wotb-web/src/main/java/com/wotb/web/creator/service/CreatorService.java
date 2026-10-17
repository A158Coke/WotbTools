package com.wotb.web.creator.service;

import com.wotb.web.creator.dto.CreatorDtos;
import com.wotb.web.creator.entity.Creator;
import com.wotb.web.creator.entity.CreatorCategory;
import com.wotb.web.creator.entity.CreatorLevel;
import com.wotb.web.creator.mapper.CreatorMapper;
import com.wotb.web.creator.repository.CreatorCategoryRepository;
import com.wotb.web.creator.repository.CreatorLevelRepository;
import com.wotb.web.creator.repository.CreatorRepository;
import com.wotb.web.creator.repository.CreatorCatalogLockRepository;
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
    private static final Pattern UID_INPUT = Pattern.compile(
            "[\\s\\p{Zs}\\u2028\\u2029\\uFEFF]*([0-9]{1,20})[\\s\\p{Zs}\\u2028\\u2029\\uFEFF]*");
    private final CreatorRepository creators;
    private final CreatorCategoryRepository categories;
    private final CreatorLevelRepository levels;
    private final CreatorCatalogLockRepository catalog;
    private final CreatorMapper mapper;
    private final CreatorAvatarService avatars;
    private final TransactionTemplate writes;

    public CreatorService(final CreatorRepository creators, final CreatorCategoryRepository categories,
                          final CreatorLevelRepository levels, final CreatorCatalogLockRepository catalog,
                          final CreatorMapper mapper, final CreatorAvatarService avatars,
                          final PlatformTransactionManager transactions) {
        this.creators = creators; this.categories = categories; this.levels = levels;
        this.catalog = catalog; this.mapper = mapper; this.avatars = avatars;
        this.writes = new TransactionTemplate(transactions);
    }
    @Transactional(readOnly = true)
    public List<CreatorDtos.Category> categories() { return categories.findAllByOrderByIdAsc().stream().map(mapper::category).toList(); }
    @Transactional(readOnly = true)
    public List<CreatorDtos.Category> publicCategories() {
        return categories.findPopulatedByOrderByIdAsc().stream().map(mapper::category).toList();
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public CreatorDtos.Metadata metadata() {
        return new CreatorDtos.Metadata(categories(), levels.findAllByOrderByIdAsc().stream().map(mapper::level).toList(), avatars.configured());
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public List<CreatorDtos.Card> list(final Long categoryId) {
        if (categoryId != null && categoryId <= 0) { throw invalid(); }
        final List<Creator> rows = creators.publicList(categoryId);
        final Map<Long, CreatorDtos.Category> categoryMap = categories().stream().collect(Collectors.toMap(CreatorDtos.Category::id, Function.identity()));
        final Map<Long, CreatorDtos.Level> levelMap = levels.findAllByOrderByIdAsc().stream().map(mapper::level)
                .collect(Collectors.toMap(CreatorDtos.Level::id, Function.identity()));
        return rows.stream().map(creator -> mapper.card(creator, categoryMap, levelMap)).toList();
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public CreatorDtos.Detail detail(final long id) { return mapper.toDto(creators.findById(id).orElseThrow(CreatorService::notFound)); }

    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public CreatorDtos.Detail create(final CreatorDtos.SaveRequest request, final MultipartFile avatar) { return save(null, request, avatar); }
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public CreatorDtos.Detail update(final long id, final CreatorDtos.SaveRequest request, final MultipartFile avatar) {
        if (id <= 0) { throw invalid(); }
        return save(id, request, avatar);
    }
    private CreatorDtos.Detail save(final Long id, final CreatorDtos.SaveRequest request, final MultipartFile avatar) {
        validate(request, avatar);
        if ((id == null && request.expectedVersion() != null)
                || (id != null && (request.expectedVersion() == null || request.expectedVersion() < 0))) { throw invalid(); }
        final String uid = uid(request.bilibiliUid());
        // The committed, site-owned upload remains discoverable if the following catalog transaction fails.
        final String uploaded = "REPLACE".equals(request.avatarAction()) ? avatars.upload(avatar) : null;
        return writes.execute(tx -> {
            lockCatalog();
            final Creator creator = id == null ? new Creator() : locked(id);
            if (id != null) { requireVersion(creator, request.expectedVersion()); }
            final boolean duplicate = id == null ? creators.existsByBilibiliUid(uid) : creators.existsByBilibiliUidAndIdNot(uid, id);
            if (duplicate) { throw error(ApiErrorCode.CREATOR_UID_ALREADY_EXISTS); }
            if (categories.findAllById(request.categoryIds()).size() != request.categoryIds().size()
                    || (request.levelId() != null && !levels.existsById(request.levelId()))) {
                throw error(ApiErrorCode.CREATOR_CONFIG_CONFLICT);
            }
            creator.bilibiliUid = uid; creator.name = name(request.name());
            creator.description = StringUtils.hasText(request.description()) ? request.description().trim() : null;
            creator.categoryIds.clear(); creator.categoryIds.addAll(new LinkedHashSet<>(request.categoryIds()));
            creator.levelId = request.levelId(); creator.stars = request.stars();
            if (id == null) { creator.createdAt = Instant.now(); }
            else { creator.version++; }
            final String previous = creator.avatarId;
            if ("REPLACE".equals(request.avatarAction())) { avatars.attach(uploaded); creator.avatarId = uploaded; }
            else if ("REMOVE".equals(request.avatarAction())) { creator.avatarId = null; }
            creators.saveAndFlush(creator);
            if (!Objects.equals(previous, creator.avatarId)) { avatars.detach(previous); }
            return mapper.toDto(creator);
        });
    }
    public void delete(final long id, final long expectedVersion) {
        if (id <= 0 || expectedVersion < 0) { throw invalid(); }
        lockCatalog();
        final Creator creator = locked(id);
        requireVersion(creator, expectedVersion);
        final String previous = creator.avatarId;
        creators.delete(creator); creators.flush(); avatars.detach(previous);
    }
    public CreatorDtos.Category addCategory(final CreatorDtos.DictionaryRequest request) {
        lockCatalog();
        final CreatorCategory category = new CreatorCategory(); category.name = name(request == null ? null : request.name());
        return mapper.category(categories.saveAndFlush(category));
    }
    public void deleteCategory(final long id) {
        lockCatalog();
        final CreatorCategory category = categories.findById(id).orElseThrow(CreatorService::notFound);
        if (creators.wouldOrphanCreator(id)) { throw error(ApiErrorCode.CREATOR_CATEGORY_IN_USE); }
        for (final Creator creator : creators.findCategoryMembersLocked(id)) { creator.version++; }
        creators.removeCategoryLinks(id); categories.delete(category); categories.flush();
    }
    public CreatorDtos.Level addLevel(final CreatorDtos.DictionaryRequest request) {
        lockCatalog();
        final CreatorLevel level = new CreatorLevel(); level.name = name(request == null ? null : request.name());
        return mapper.level(levels.saveAndFlush(level));
    }
    public void deleteLevel(final long id) {
        lockCatalog();
        final CreatorLevel level = levels.findById(id).orElseThrow(CreatorService::notFound);
        if (creators.existsByLevelId(id)) { throw error(ApiErrorCode.CREATOR_LEVEL_IN_USE); }
        levels.delete(level); levels.flush();
    }
    private void lockCatalog() { Objects.requireNonNull(catalog.findExclusive(), "Creator catalog lock is missing"); }
    private static void requireVersion(final Creator creator, final long expectedVersion) {
        if (creator.version != expectedVersion) { throw error(ApiErrorCode.CREATOR_CONFIG_CONFLICT); }
    }
    private Creator locked(final long id) { return creators.findLocked(id).orElseThrow(CreatorService::notFound); }
    private static void validate(final CreatorDtos.SaveRequest request, final MultipartFile avatar) {
        if (request == null || request.stars() < 1 || request.stars() > 5
                || request.categoryIds() == null || request.categoryIds().isEmpty()
                || request.categoryIds().stream().anyMatch(id -> id == null || id <= 0)
                || new HashSet<>(request.categoryIds()).size() != request.categoryIds().size()
                || (request.levelId() != null && request.levelId() <= 0)
                || request.avatarAction() == null || !List.of("KEEP", "REPLACE", "REMOVE").contains(request.avatarAction())
                || ("REPLACE".equals(request.avatarAction()) != (avatar != null))
                || (request.description() != null && request.description().codePointCount(0, request.description().length()) > 2000)) { throw invalid(); }
        name(request.name()); uid(request.bilibiliUid());
    }
    private static String name(final String raw) {
        if (!StringUtils.hasText(raw)) { throw invalid(); }
        final String trimmed = raw.trim();
        if (trimmed.codePointCount(0, trimmed.length()) > 100) { throw invalid(); }
        return trimmed;
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

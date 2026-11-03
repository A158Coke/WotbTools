package com.wotb.web.creator;

import com.wotb.web.creator.dto.RecommendationDtos;
import com.wotb.web.creator.entity.Creator;
import com.wotb.web.creator.entity.CreatorCategory;
import com.wotb.web.creator.entity.CreatorLevel;
import com.wotb.web.creator.mapper.CreatorMapper;
import com.wotb.web.creator.repository.CreatorCategoryRepository;
import com.wotb.web.creator.repository.CreatorLevelRepository;
import com.wotb.web.creator.repository.CreatorRepository;
import com.wotb.web.creator.service.CreatorAvatarService;
import com.wotb.web.creator.service.CreatorService;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Unit-level write oracles for the recommendation catalog: version contract, duplicate ownership,
 * category/level reference integrity and avatar ledger consistency. No database or Docker required. */
class CreatorServiceTest {
    private final CreatorRepository creators = mock(CreatorRepository.class);
    private final CreatorCategoryRepository categories = mock(CreatorCategoryRepository.class);
    private final CreatorLevelRepository levels = mock(CreatorLevelRepository.class);
    private final CreatorAvatarService avatars = mock(CreatorAvatarService.class);
    private final PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
    private final Map<Long, Creator> rows = new HashMap<>();
    private final Map<Long, CreatorCategory> categoryRows = new HashMap<>();
    private final Set<Long> levelRows = new java.util.HashSet<>();
    private final List<String> attached = new java.util.ArrayList<>();
    private final List<String> detached = new java.util.ArrayList<>();
    private long sequence;
    private CreatorService service;

    @BeforeEach
    void setup() {
        when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(creators.lockCatalog()).thenReturn(1);
        when(creators.findLocked(anyLong())).thenAnswer(
                call -> Optional.ofNullable(rows.get(((Number) call.getArgument(0)).longValue())));
        when(creators.existsByTypeAndExternalId(anyString(), anyString())).thenAnswer(
                call -> rows.values().stream().anyMatch(row -> row.type.equals(call.getArgument(0))
                        && row.externalId.equals(call.getArgument(1))));
        when(creators.existsByTypeAndExternalIdAndIdNot(anyString(), anyString(), anyLong())).thenAnswer(
                call -> rows.values().stream().anyMatch(row -> row.type.equals(call.getArgument(0))
                        && row.externalId.equals(call.getArgument(1)) && !row.id.equals(call.getArgument(2))));
        when(creators.saveAndFlush(any(Creator.class))).thenAnswer(call -> {
            final Creator saved = call.getArgument(0);
            if (saved.id == null) { saved.id = ++sequence; }
            rows.put(saved.id, saved);
            return saved;
        });
        doAnswer(call -> rows.remove(((Creator) call.getArgument(0)).id)).when(creators).delete(any(Creator.class));
        doAnswer(call -> categoryRows.remove(((CreatorCategory) call.getArgument(0)).id)).when(categories).delete(any(CreatorCategory.class));
        when(categories.findById(anyLong())).thenAnswer(
                call -> Optional.ofNullable(categoryRows.get(((Number) call.getArgument(0)).longValue())));
        when(categories.findAllById(anyList())).thenAnswer(call -> ((List<Long>) call.getArgument(0)).stream()
                .map(categoryRows::get).filter(java.util.Objects::nonNull).toList());
        when(levels.existsById(anyLong())).thenAnswer(call -> levelRows.contains(((Number) call.getArgument(0)).longValue()));
        when(avatars.upload(any())).thenReturn("new-avatar");
        doAnswer(call -> attached.add(call.getArgument(0))).when(avatars).attach(anyString());
        doAnswer(call -> detached.add(call.getArgument(0))).when(avatars).detach(any());
        service = new CreatorService(creators, categories, levels, new CreatorMapper(), avatars, transactions);
    }

    private Creator existingUp() {
        final Creator creator = new Creator();
        creator.id = ++sequence; creator.version = 5; creator.type = "UP"; creator.externalId = "100";
        creator.name = "Original"; creator.createdAt = java.time.Instant.parse("2026-01-01T00:00:00Z");
        creator.categoryIds = new LinkedHashSet<>(List.of(1L)); creator.avatarId = "old-avatar";
        rows.put(creator.id, creator);
        return creator;
    }

    private CreatorCategory category(final long id, final String type) {
        final CreatorCategory row = new CreatorCategory();
        row.id = id; row.type = type; row.name = "Category " + id;
        categoryRows.put(id, row);
        return row;
    }

    private RecommendationDtos.SaveRequest save(final Long expectedVersion) {
        return new RecommendationDtos.SaveRequest("UP", "200", "Creator", null, List.of(1L), null, 3, "KEEP", expectedVersion);
    }

    @Test
    void createRejectsANonNullExpectedVersionWithoutTouchingTheCatalog() {
        final ApiException error = assertThrows(ApiException.class, () -> service.createRecommendation(save(0L), null));
        assertEquals(ApiErrorCode.CREATOR_INVALID_REQUEST, error.errorCode());
        assertTrue(rows.isEmpty());
        verify(creators, never()).saveAndFlush(any(Creator.class));
    }

    @Test
    void createAcceptsNullExpectedVersionAndLeavesVersionZero() {
        category(1, "UP");
        final RecommendationDtos.Detail detail = service.createRecommendation(save(null), null);
        assertEquals(0, detail.version());
        assertEquals("200", detail.externalId());
        assertEquals(1, rows.size());
    }

    @Test
    void updateRequiresAnExpectedVersion() {
        final Creator creator = existingUp();
        final ApiException error = assertThrows(ApiException.class,
                () -> service.updateRecommendation(creator.id, save(null), null));
        assertEquals(ApiErrorCode.CREATOR_INVALID_REQUEST, error.errorCode());
        assertTrue(rows.containsKey(creator.id));
        assertEquals(5, rows.get(creator.id).version);
        verify(creators, never()).saveAndFlush(any(Creator.class));
    }

    @Test
    void updateAcceptsVersionZeroButRejectsNegativeExpectedVersions() {
        category(1, "UP");
        final Creator creator = existingUp();
        creator.version = 0;
        // Version 0 is the legitimate first published revision; <= 0 would wrongly reject it.
        assertEquals(1, service.updateRecommendation(creator.id, save(0L), null).version());
        final ApiException error = assertThrows(ApiException.class,
                () -> service.updateRecommendation(creator.id, save(-1L), null));
        assertEquals(ApiErrorCode.CREATOR_INVALID_REQUEST, error.errorCode());
    }

    @Test
    void staleExpectedVersionConflictsAndLeavesTheStoredRowUntouched() {
        category(1, "UP");
        final Creator creator = existingUp();
        final ApiException error = assertThrows(ApiException.class,
                () -> service.updateRecommendation(creator.id, save(4L), null));
        assertEquals(ApiErrorCode.CREATOR_CONFIG_CONFLICT, error.errorCode());
        assertEquals(5, rows.get(creator.id).version);
        assertEquals("Original", rows.get(creator.id).name);
        assertEquals("100", rows.get(creator.id).externalId);
        verify(creators, never()).saveAndFlush(any(Creator.class));
        verify(avatars, never()).attach(anyString());
        verify(avatars, never()).detach(any());
    }

    @Test
    void successfulUpdateIncrementsTheVersionExactlyOnce() {
        category(1, "UP");
        final Creator creator = existingUp();
        final RecommendationDtos.Detail detail = service.updateRecommendation(creator.id, save(5L), null);
        assertEquals(6, detail.version());
        assertEquals(6, rows.get(creator.id).version);
        assertEquals("Creator", rows.get(creator.id).name);
    }

    @Test
    void updateOnlyMatchesTheSameCreatorType() {
        final Creator creator = existingUp();
        final ApiException error = assertThrows(ApiException.class,
                () -> service.updateRecommendation(creator.id,
                        new RecommendationDtos.SaveRequest("VIDEO", "BV1abcdefghi", "Creator", null, List.of(1L), null, 3, "KEEP", 5L), null));
        assertEquals(ApiErrorCode.CREATOR_NOT_FOUND, error.errorCode());
        assertEquals("Original", rows.get(creator.id).name);
    }

    @Test
    void duplicateUpCreationIsRejectedWithTheUidErrorCode() {
        category(1, "UP");
        existingUp();
        final ApiException error = assertThrows(ApiException.class, () -> service.createRecommendation(
                new RecommendationDtos.SaveRequest("UP", "100", "Copy", null, List.of(1L), null, 3, "KEEP", null), null));
        assertEquals(ApiErrorCode.CREATOR_UID_ALREADY_EXISTS, error.errorCode());
        assertEquals(1, rows.size());
    }

    @Test
    void duplicateVideoCreationIsRejectedWithTheRecommendationErrorCode() {
        category(1, "VIDEO");
        final Creator video = new Creator();
        video.id = ++sequence; video.version = 0; video.type = "VIDEO"; video.externalId = "BV1abcdefghi";
        video.name = "Video"; video.createdAt = java.time.Instant.now();
        video.categoryIds = new LinkedHashSet<>(List.of(1L));
        rows.put(video.id, video);
        final ApiException error = assertThrows(ApiException.class, () -> service.createRecommendation(
                new RecommendationDtos.SaveRequest("VIDEO", "BV1abcdefghi", "Copy", null, List.of(1L), null, 3, "KEEP", null), null));
        assertEquals(ApiErrorCode.RECOMMENDATION_ID_ALREADY_EXISTS, error.errorCode());
        assertEquals(1, rows.size());
    }

    @Test
    void updateWithOwnExternalIdDoesNotFalselyConflict() {
        category(1, "UP");
        final Creator creator = existingUp();
        // 提交当前 creator 自己的 externalId：只有 IdNot 自排除正确时更新才能成功。
        final RecommendationDtos.Detail detail = service.updateRecommendation(creator.id,
                new RecommendationDtos.SaveRequest("UP", "100", "Creator", null, List.of(1L), null, 3, "KEEP", 5L), null);
        assertEquals(6, detail.version());
        assertEquals("100", detail.externalId());
        assertEquals(1, rows.size());
        verify(creators).existsByTypeAndExternalIdAndIdNot("UP", "100", creator.id);
    }

    @Test
    void updateIntoAnotherCreatorsExternalIdConflictsAndKeepsBothRows() {
        category(1, "UP");
        final Creator first = existingUp();
        final Creator second = new Creator();
        second.id = ++sequence; second.version = 0; second.type = "UP"; second.externalId = "300";
        second.name = "Second"; second.createdAt = java.time.Instant.now();
        second.categoryIds = new LinkedHashSet<>(List.of(1L));
        rows.put(second.id, second);
        final ApiException error = assertThrows(ApiException.class, () -> service.updateRecommendation(second.id,
                new RecommendationDtos.SaveRequest("UP", "100", "Second", null, List.of(1L), null, 3, "KEEP", 0L), null));
        assertEquals(ApiErrorCode.CREATOR_UID_ALREADY_EXISTS, error.errorCode());
        assertEquals("300", rows.get(second.id).externalId);
        assertEquals("Second", rows.get(second.id).name);
        assertEquals(0, rows.get(second.id).version);
        assertEquals("100", rows.get(first.id).externalId);
    }

    @Test
    void categoryOfAnotherTypeIsRejectedWithoutSaving() {
        category(1, "VIDEO");
        final Creator creator = existingUp();
        final ApiException error = assertThrows(ApiException.class,
                () -> service.updateRecommendation(creator.id, save(5L), null));
        assertEquals(ApiErrorCode.CREATOR_NOT_FOUND, error.errorCode());
        verify(creators, never()).saveAndFlush(any(Creator.class));
    }

    @Test
    void missingCategoryIsAConfigConflict() {
        final Creator creator = existingUp();
        final ApiException error = assertThrows(ApiException.class,
                () -> service.updateRecommendation(creator.id,
                        new RecommendationDtos.SaveRequest("UP", "100", "Creator", null, List.of(9L), null, 3, "KEEP", 5L), null));
        assertEquals(ApiErrorCode.CREATOR_CONFIG_CONFLICT, error.errorCode());
        assertEquals(1, creator.categoryIds.size());
        assertEquals(5, rows.get(creator.id).version);
        verify(creators, never()).saveAndFlush(any(Creator.class));
    }

    @Test
    void missingLevelIsAConfigConflict() {
        // category 存在且类型正确，使 missing-level 守卫成为唯一会拒绝该请求的分支。
        final Creator creator = existingUp();
        category(1, "UP");
        final ApiException error = assertThrows(ApiException.class,
                () -> service.updateRecommendation(creator.id,
                        new RecommendationDtos.SaveRequest("UP", "100", "Creator", null, List.of(1L), 7L, 3, "KEEP", 5L), null));
        assertEquals(ApiErrorCode.CREATOR_CONFIG_CONFLICT, error.errorCode());
        verify(levels).existsById(7L);
        assertEquals(5, rows.get(creator.id).version);
        assertEquals("Original", rows.get(creator.id).name);
        verify(creators, never()).saveAndFlush(any(Creator.class));
    }

    @Test
    void deleteCategoryBumpsEveryAffectedCreatorVersionOnceAndRemovesTheLinks() {
        final Creator member = existingUp();
        final Creator bystander = new Creator();
        bystander.id = ++sequence; bystander.version = 2; bystander.type = "UP"; bystander.externalId = "400";
        bystander.name = "Bystander"; bystander.createdAt = java.time.Instant.now();
        bystander.categoryIds = new LinkedHashSet<>(List.of(2L));
        rows.put(bystander.id, bystander);
        final CreatorCategory removed = category(1, "UP");
        when(creators.wouldOrphanCreator(1L)).thenReturn(false);
        when(creators.findCategoryMembersLocked(1L)).thenReturn(List.of(member));
        service.deleteRecommendationCategory("UP", 1L);
        assertEquals(6, member.version);
        assertEquals(2, bystander.version);
        verify(creators).removeCategoryLinks(1L);
        verify(categories).delete(removed);
        assertFalse(categoryRows.containsKey(1L));
    }

    @Test
    void deletingACategoryThatWouldOrphanACreatorIsRejectedAndKeepsTheCatalog() {
        category(1, "UP");
        when(creators.wouldOrphanCreator(1L)).thenReturn(true);
        final ApiException error = assertThrows(ApiException.class, () -> service.deleteRecommendationCategory("UP", 1L));
        assertEquals(ApiErrorCode.CREATOR_CATEGORY_IN_USE, error.errorCode());
        verify(creators, never()).removeCategoryLinks(1L);
        verify(categories, never()).delete(any(CreatorCategory.class));
    }

    @Test
    void deletingALevelStillReferencedByACreatorIsRejected() {
        final Creator creator = existingUp();
        creator.levelId = 3L;
        final CreatorLevel level = new CreatorLevel();
        level.id = 3L; level.name = "Expert";
        when(levels.findById(3L)).thenReturn(Optional.of(level));
        when(creators.existsByLevelId(3L)).thenAnswer(
                call -> rows.values().stream().anyMatch(row -> row.levelId != null && row.levelId.equals(call.getArgument(0))));
        final ApiException error = assertThrows(ApiException.class, () -> service.deleteLevel(3L));
        assertEquals(ApiErrorCode.CREATOR_LEVEL_IN_USE, error.errorCode());
        verify(levels, never()).delete(any(CreatorLevel.class));
        assertEquals(3L, creator.levelId);
    }

    @Test
    void imageReplacementDetachesOnlyThePreviousAvatarOnceTheRowIsFlushed() {
        category(1, "UP");
        final Creator creator = existingUp();
        service.updateRecommendation(creator.id,
                new RecommendationDtos.SaveRequest("UP", "100", "Creator", null, List.of(1L), null, 3, "REPLACE", 5L),
                new org.springframework.mock.web.MockMultipartFile("image", new byte[] {1, 2, 3}));
        assertEquals("new-avatar", rows.get(creator.id).avatarId);
        assertEquals(List.of("new-avatar"), attached);
        assertEquals(List.of("old-avatar"), detached);
        assertEquals(6, rows.get(creator.id).version);
    }

    @Test
    void keepingTheImageDoesNotTouchTheAvatarLedger() {
        category(1, "UP");
        final Creator creator = existingUp();
        service.updateRecommendation(creator.id, save(5L), null);
        verify(avatars, never()).attach(anyString());
        verify(avatars, never()).detach(any());
        assertEquals("old-avatar", rows.get(creator.id).avatarId);
    }

    @Test
    void removingTheImageClearsTheReferenceAndDetachesTheOldAvatar() {
        category(1, "UP");
        final Creator creator = existingUp();
        service.updateRecommendation(creator.id,
                new RecommendationDtos.SaveRequest("UP", "100", "Creator", null, List.of(1L), null, 3, "REMOVE", 5L), null);
        assertNull(rows.get(creator.id).avatarId);
        assertEquals(List.of("old-avatar"), detached);
        assertTrue(attached.isEmpty());
    }

    @Test
    void deleteRemovesTheRowAndDetachesTheAvatar() {
        final Creator creator = existingUp();
        service.deleteRecommendation("UP", creator.id, 5L);
        assertFalse(rows.containsKey(creator.id));
        assertEquals(List.of("old-avatar"), detached);
    }

    @Test
    void deleteWithAStaleVersionConflictsAndKeepsTheRow() {
        final Creator creator = existingUp();
        final ApiException error = assertThrows(ApiException.class, () -> service.deleteRecommendation("UP", creator.id, 4L));
        assertEquals(ApiErrorCode.CREATOR_CONFIG_CONFLICT, error.errorCode());
        assertTrue(rows.containsKey(creator.id));
        verify(avatars, never()).detach(any());
    }

    @Test
    void deletingACategoryUnderAnotherTypeIsNotFoundAndKeepsTheCatalog() {
        category(1, "UP");
        when(creators.wouldOrphanCreator(1L)).thenReturn(false);
        final ApiException error = assertThrows(ApiException.class, () -> service.deleteRecommendationCategory("VIDEO", 1L));
        assertEquals(ApiErrorCode.CREATOR_NOT_FOUND, error.errorCode());
        verify(creators, never()).removeCategoryLinks(1L);
        verify(categories, never()).delete(any(CreatorCategory.class));
    }

    @Test
    void nonPositiveCategoryIdsAreInvalidRequests() {
        final Creator creator = existingUp();
        assertEquals(ApiErrorCode.CREATOR_INVALID_REQUEST, assertThrows(ApiException.class,
                () -> service.updateRecommendation(creator.id,
                        new RecommendationDtos.SaveRequest("UP", "100", "Creator", null, java.util.Arrays.asList(1L, 0L), null, 3, "KEEP", 5L), null)).errorCode());
        assertEquals(ApiErrorCode.CREATOR_INVALID_REQUEST, assertThrows(ApiException.class,
                () -> service.updateRecommendation(creator.id,
                        new RecommendationDtos.SaveRequest("UP", "100", "Creator", null, java.util.Arrays.asList(1L, null), null, 3, "KEEP", 5L), null)).errorCode());
        assertEquals(5, rows.get(creator.id).version);
    }

    @Test
    void deleteGuardsTheCreatorTypeAndAcceptsVersionZero() {
        final Creator creator = existingUp();
        creator.version = 0;
        final ApiException wrongType = assertThrows(ApiException.class, () -> service.deleteRecommendation("VIDEO", creator.id, 0L));
        assertEquals(ApiErrorCode.CREATOR_NOT_FOUND, wrongType.errorCode());
        assertTrue(rows.containsKey(creator.id));
        assertEquals("old-avatar", rows.get(creator.id).avatarId);
        final ApiException zeroId = assertThrows(ApiException.class, () -> service.deleteRecommendation("UP", 0L, 0L));
        assertEquals(ApiErrorCode.CREATOR_INVALID_REQUEST, zeroId.errorCode());
        service.deleteRecommendation("UP", creator.id, 0L);
        assertFalse(rows.containsKey(creator.id));
        assertEquals(List.of("old-avatar"), detached);
    }

    @Test
    void updateReplacesTheWholeCategorySelectionInsteadOfAccumulating() {
        category(1, "UP"); category(2, "UP");
        final Creator creator = existingUp();
        final RecommendationDtos.Detail detail = service.updateRecommendation(creator.id,
                new RecommendationDtos.SaveRequest("UP", "100", "Creator", null, List.of(2L), null, 3, "KEEP", 5L), null);
        assertEquals(List.of(2L), detail.categoryIds());
        assertEquals(1, creator.categoryIds.size());
        assertTrue(creator.categoryIds.contains(2L));
    }

    @Test
    void validateAcceptsInclusiveStarsDescriptionAndNameBoundaries() {
        category(1, "UP");
        levelRows.add(1L);
        final Creator creator = existingUp();
        final String maxName = "n".repeat(100);
        final String maxDescription = "d".repeat(2000);
        final RecommendationDtos.Detail detail = service.updateRecommendation(creator.id,
                new RecommendationDtos.SaveRequest("UP", "100", maxName, maxDescription, List.of(1L), 1L, 5, "KEEP", 5L), null);
        assertEquals(5, detail.stars());
        assertEquals(maxName, detail.name());
        assertEquals(maxDescription, detail.description());
        assertEquals(1L, detail.levelId());
        // stars 1 and 5 are the inclusive wire contract; 0 and 6 are outside it.
        assertEquals(1, service.updateRecommendation(creator.id,
                new RecommendationDtos.SaveRequest("UP", "100", "Creator", null, List.of(1L), null, 1, "KEEP", 6L), null).stars());
        assertEquals(ApiErrorCode.CREATOR_INVALID_REQUEST, assertThrows(ApiException.class, () -> service.updateRecommendation(creator.id,
                new RecommendationDtos.SaveRequest("UP", "100", "Creator", null, List.of(1L), null, 0, "KEEP", 6L), null)).errorCode());
        assertEquals(ApiErrorCode.CREATOR_INVALID_REQUEST, assertThrows(ApiException.class, () -> service.updateRecommendation(creator.id,
                new RecommendationDtos.SaveRequest("UP", "100", "Creator", null, List.of(1L), null, 6, "KEEP", 6L), null)).errorCode());
        assertEquals(ApiErrorCode.CREATOR_INVALID_REQUEST, assertThrows(ApiException.class, () -> service.updateRecommendation(creator.id,
                new RecommendationDtos.SaveRequest("UP", "100", "n".repeat(101), null, List.of(1L), null, 3, "KEEP", 6L), null)).errorCode());
        assertEquals(ApiErrorCode.CREATOR_INVALID_REQUEST, assertThrows(ApiException.class, () -> service.updateRecommendation(creator.id,
                new RecommendationDtos.SaveRequest("UP", "100", "Creator", "d".repeat(2001), List.of(1L), null, 3, "KEEP", 6L), null)).errorCode());
        assertEquals(ApiErrorCode.CREATOR_INVALID_REQUEST, assertThrows(ApiException.class, () -> service.updateRecommendation(creator.id,
                new RecommendationDtos.SaveRequest("UP", "100", "Creator", null, List.of(1L), 0L, 3, "KEEP", 6L), null)).errorCode());
        assertEquals(ApiErrorCode.CREATOR_INVALID_REQUEST, assertThrows(ApiException.class, () -> service.updateRecommendation(0L, save(0L), null)).errorCode());
    }

    @Test
    void detailExposesTheAvatarUrlOnlyWhenAnAvatarIsAttached() {
        category(1, "UP");
        final Creator creator = existingUp();
        assertEquals("old-avatar", service.updateRecommendation(creator.id, save(5L), null).imageUrl()
                .substring(creatorAvatarPath().length() + 1));
        creator.avatarId = null;
        assertNull(service.updateRecommendation(creator.id, save(6L), null).imageUrl());
    }

    private String creatorAvatarPath() {
        return com.wotb.web.config.ApiPaths.CREATOR_AVATARS;
    }
}

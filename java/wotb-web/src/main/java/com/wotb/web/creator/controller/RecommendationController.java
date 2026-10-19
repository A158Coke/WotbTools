package com.wotb.web.creator.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.creator.dto.RecommendationDtos;
import com.wotb.web.creator.service.CreatorService;
import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import java.util.List;

/** Typed recommendations and their shared dictionaries. */
@RestController
public class RecommendationController {
    private final CreatorService service;
    public RecommendationController(final CreatorService service) { this.service = service; }
    @GetMapping(ApiPaths.RECOMMENDATIONS)
    public List<RecommendationDtos.Card> list(@RequestParam(name = "type") final String type,
                                              @RequestParam(name = "categoryId", required = false) final Long categoryId) {
        return service.recommendations(type, categoryId);
    }
    @GetMapping(ApiPaths.RECOMMENDATIONS + "/categories")
    public List<RecommendationDtos.Category> categories() { return service.publicRecommendationCategories(); }
    @GetMapping(ApiPaths.RECOMMENDATIONS_ADMIN + "/metadata")
    public RecommendationDtos.Metadata metadata(@RequestParam(name = "type") final String type) {
        return service.recommendationMetadata(type);
    }
    @GetMapping(ApiPaths.RECOMMENDATIONS_ADMIN + "/{id}")
    public RecommendationDtos.Detail detail(@PathVariable final long id, @RequestParam(name = "type") final String type) {
        return service.recommendationDetail(type, id);
    }
    @PostMapping(value = ApiPaths.RECOMMENDATIONS_ADMIN, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public RecommendationDtos.Detail create(@RequestPart(name = "payload") final RecommendationDtos.SaveRequest request,
                                             @RequestPart(name = "image", required = false) final List<MultipartFile> files) {
        return service.createRecommendation(request, singleImage(files));
    }
    @PutMapping(value = ApiPaths.RECOMMENDATIONS_ADMIN + "/{id}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public RecommendationDtos.Detail update(@PathVariable final long id,
                                             @RequestPart(name = "payload") final RecommendationDtos.SaveRequest request,
                                             @RequestPart(name = "image", required = false) final List<MultipartFile> files) {
        return service.updateRecommendation(id, request, singleImage(files));
    }
    @DeleteMapping(ApiPaths.RECOMMENDATIONS_ADMIN + "/{id}")
    public ResponseEntity<Void> delete(@PathVariable final long id, @RequestParam(name = "type") final String type,
                                        @RequestParam(name = "expectedVersion") final long expectedVersion) {
        service.deleteRecommendation(type, id, expectedVersion); return ResponseEntity.noContent().build();
    }
    @PostMapping(ApiPaths.RECOMMENDATIONS_ADMIN + "/categories")
    @ResponseStatus(HttpStatus.CREATED)
    public RecommendationDtos.Category category(@RequestBody final RecommendationDtos.CategoryRequest request) {
        return service.addRecommendationCategory(request);
    }
    @DeleteMapping(ApiPaths.RECOMMENDATIONS_ADMIN + "/categories/{id}")
    public ResponseEntity<Void> deleteCategory(@PathVariable final long id, @RequestParam(name = "type") final String type) {
        service.deleteRecommendationCategory(type, id); return ResponseEntity.noContent().build();
    }
    @PostMapping(ApiPaths.RECOMMENDATIONS_ADMIN + "/levels")
    @ResponseStatus(HttpStatus.CREATED)
    public RecommendationDtos.Level level(@RequestBody final RecommendationDtos.DictionaryRequest request) {
        return service.addLevel(request);
    }
    @DeleteMapping(ApiPaths.RECOMMENDATIONS_ADMIN + "/levels/{id}")
    public ResponseEntity<Void> deleteLevel(@PathVariable final long id) {
        service.deleteLevel(id); return ResponseEntity.noContent().build();
    }
    private static MultipartFile singleImage(final List<MultipartFile> files) {
        if (files == null || files.isEmpty()) { return null; }
        if (files.size() != 1) { throw new ApiException(ApiErrorCode.CREATOR_INVALID_REQUEST); }
        return files.getFirst();
    }
}

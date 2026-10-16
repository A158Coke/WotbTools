package com.wotb.web.creator.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.creator.dto.CreatorDtos;
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
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import java.util.List;

@RestController
@RequestMapping(ApiPaths.CREATORS_ADMIN)
public class CreatorAdminController {
    private final CreatorService service;
    public CreatorAdminController(final CreatorService service) { this.service = service; }
    @GetMapping("/metadata")
    public CreatorDtos.Metadata metadata() { return service.metadata(); }
    @GetMapping("/{id}")
    public CreatorDtos.Detail detail(@PathVariable final long id) { return service.detail(id); }
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public CreatorDtos.Detail create(@RequestPart(name = "payload") final CreatorDtos.SaveRequest request,
                                     @RequestPart(name = "avatar", required = false) final List<MultipartFile> files) {
        return service.create(request, singleAvatar(files));
    }
    @PutMapping(value = "/{id}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public CreatorDtos.Detail update(@PathVariable final long id,
                                     @RequestPart(name = "payload") final CreatorDtos.SaveRequest request,
                                     @RequestPart(name = "avatar", required = false) final List<MultipartFile> files) {
        return service.update(id, request, singleAvatar(files));
    }
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable final long id,
                                        @RequestParam(name = "expectedVersion") final long expectedVersion) {
        service.delete(id, expectedVersion); return ResponseEntity.noContent().build();
    }
    @PostMapping("/categories")
    @ResponseStatus(HttpStatus.CREATED)
    public CreatorDtos.Category category(@RequestBody final CreatorDtos.DictionaryRequest request) { return service.addCategory(request); }
    @DeleteMapping("/categories/{id}")
    public ResponseEntity<Void> deleteCategory(@PathVariable final long id) { service.deleteCategory(id); return ResponseEntity.noContent().build(); }
    @PostMapping("/levels")
    @ResponseStatus(HttpStatus.CREATED)
    public CreatorDtos.Level level(@RequestBody final CreatorDtos.DictionaryRequest request) { return service.addLevel(request); }
    @DeleteMapping("/levels/{id}")
    public ResponseEntity<Void> deleteLevel(@PathVariable final long id) { service.deleteLevel(id); return ResponseEntity.noContent().build(); }
    private static MultipartFile singleAvatar(final List<MultipartFile> files) {
        if (files == null || files.isEmpty()) { return null; }
        if (files.size() != 1) { throw new ApiException(ApiErrorCode.CREATOR_INVALID_REQUEST); }
        return files.getFirst();
    }
}

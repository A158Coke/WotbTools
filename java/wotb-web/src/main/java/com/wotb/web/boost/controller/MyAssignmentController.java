package com.wotb.web.boost.controller;

import com.wotb.web.boost.dto.BoostAssignmentDto;
import com.wotb.web.boost.dto.BoosterDto;
import com.wotb.web.boost.dto.UpdateMyAssignmentRequest;
import com.wotb.web.boost.service.BoostAssignmentService;
import com.wotb.web.boost.service.BoosterService;
import com.wotb.web.util.JwtUtil;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Optional;

/** 打手视角接口：查看自己的分配订单。 */
@RestController
@RequestMapping("/api/booster")
@CrossOrigin(origins = "*")
public class MyAssignmentController {

    private final BoostAssignmentService assignmentService;
    private final BoosterService boosterService;

    public MyAssignmentController(final BoostAssignmentService assignmentService,
                                  final BoosterService boosterService) {
        this.assignmentService = assignmentService;
        this.boosterService = boosterService;
    }

    @GetMapping("/assignments")
    public List<BoostAssignmentDto> myAssignments() {
        final String uid = JwtUtil.requireUserId();
        final Optional<BoosterDto> boosterOpt = boosterService.findByKeycloakUserId(uid);
        if (boosterOpt.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "BOOSTER_NOT_FOUND");
        }
        return assignmentService.findByBooster(boosterOpt.get().id());
    }

    @PatchMapping("/assignments/{id}/accept")
    public BoostAssignmentDto accept(@PathVariable final Long id) {
        try {
            return assignmentService.acceptByBooster(id, currentBoosterId());
        } catch (final IllegalArgumentException | IllegalStateException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    @PatchMapping("/assignments/{id}/start")
    public BoostAssignmentDto start(@PathVariable final Long id) {
        try {
            return assignmentService.startByBooster(id, currentBoosterId());
        } catch (final IllegalArgumentException | IllegalStateException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    @PatchMapping("/assignments/{id}/complete")
    public BoostAssignmentDto complete(@PathVariable final Long id,
                                       @RequestBody(required = false) final UpdateMyAssignmentRequest body) {
        try {
            return assignmentService.completeByBooster(id, currentBoosterId(), body == null ? null : body.note());
        } catch (final IllegalArgumentException | IllegalStateException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    @PatchMapping("/assignments/{id}/decline")
    public BoostAssignmentDto decline(@PathVariable final Long id,
                                      @RequestBody(required = false) final UpdateMyAssignmentRequest body) {
        try {
            return assignmentService.declineByBooster(id, currentBoosterId(), body == null ? null : body.note());
        } catch (final IllegalArgumentException | IllegalStateException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
        }
    }

    private Long currentBoosterId() {
        final String uid = JwtUtil.requireUserId();
        final Optional<BoosterDto> boosterOpt = boosterService.findByKeycloakUserId(uid);
        if (boosterOpt.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "BOOSTER_NOT_FOUND");
        }
        return boosterOpt.get().id();
    }
}

package com.wotb.web.boost.controller;

import com.wotb.web.boost.dto.BoostAssignmentDto;
import com.wotb.web.boost.service.BoostAssignmentService;
import com.wotb.web.boost.service.BoosterService;
import com.wotb.web.util.JwtUtil;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

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
        final var boosterOpt = boosterService.findByKeycloakUserId(uid);
        if (boosterOpt.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "BOOSTER_NOT_FOUND");
        }
        return assignmentService.findByBooster(boosterOpt.get().id());
    }
}

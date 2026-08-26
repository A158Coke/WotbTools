package com.wotb.web.hof.controller;

import com.wotb.web.config.ApiPaths;
import com.wotb.web.hof.dto.HallOfFameRecordDto;
import com.wotb.web.hof.service.HallOfFameService;
import com.wotb.web.user.service.UserProfileService;
import com.wotb.web.util.JwtUtil;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 当前用户的个人名人堂战绩（HTTP 映射，业务在 HallOfFameService）。
 * 路径保持 GET {@code /api/users/profile/records} 不变；handler 归入 hof 域，
 * 避免 user 域反向依赖 hof 造成域循环。
 */
@RestController
@RequestMapping(ApiPaths.USERS)
@CrossOrigin(origins = "*")
public class MyHallOfFameRecordsController {

    private final UserProfileService userProfileService;
    private final HallOfFameService hallOfFameService;

    public MyHallOfFameRecordsController(final UserProfileService userProfileService,
                                         final HallOfFameService hallOfFameService) {
        this.userProfileService = userProfileService;
        this.hallOfFameService = hallOfFameService;
    }

    /** 当前用户的个人名人堂战绩。 */
    @GetMapping("/profile/records")
    public List<HallOfFameRecordDto> myRecords() {
        final var profileOpt = userProfileService.findByKeycloakUserId(JwtUtil.requireUserId());
        if (profileOpt.isEmpty() || profileOpt.get().wotbAccountId() == null) {
            return List.of();
        }
        return hallOfFameService.recordsByAccountId(profileOpt.get().wotbAccountId(), 50);
    }
}

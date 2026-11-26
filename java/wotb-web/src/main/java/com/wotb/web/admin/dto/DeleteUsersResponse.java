package com.wotb.web.admin.dto;

import java.util.List;

public record DeleteUsersResponse(
        int requested,
        int deleted,
        int failed,
        List<DeleteUserResult> results
) {
}

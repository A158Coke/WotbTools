/** 业务模块的跨模块依赖边界。 */
@org.springframework.modulith.ApplicationModule(allowedDependencies = {
        "replay :: capacity", "replayfile", "user :: legacy-service", "util"
})
package com.wotb.web.hundred;

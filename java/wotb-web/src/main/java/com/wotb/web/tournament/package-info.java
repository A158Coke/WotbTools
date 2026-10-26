/** 业务模块的跨模块依赖边界。 */
@org.springframework.modulith.ApplicationModule(allowedDependencies = {
        "util", "util :: errors", "util :: csv"
})
package com.wotb.web.tournament;

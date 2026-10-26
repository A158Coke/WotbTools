/** 共享支持模块的跨模块依赖边界。 */
@org.springframework.modulith.ApplicationModule(allowedDependencies = {
        "admin :: errors", "replay :: errors", "replayfile", "util :: errors"
})
package com.wotb.web.exceptionhandler;

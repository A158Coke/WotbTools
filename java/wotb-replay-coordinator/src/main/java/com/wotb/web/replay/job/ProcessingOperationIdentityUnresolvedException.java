package com.wotb.web.replay.job;

import com.wotb.web.util.apierror.ApiErrorCode;
import com.wotb.web.util.apierror.ApiException;

import java.util.Map;

/**
 * Processing create 的 operationId identity 出现「PostgreSQL 插入冲突，但随后解析不到权威
 * winner」时抛出：**fail closed**，绝不复用没有权威 operation 绑定的 jobId。
 *
 * <p>为什么不退化为「返回自己的 jobId」：{@code commitOperation} 插入冲突说明该 identity 已经被
 * 占用，本 job 没有赢得权威绑定。若此时权威行又消失（例如胜者 job 被清理、operation 行随外键
 * 级联删除），返回本 jobId 就会对外暴露一个「无 operation 映射」的 job；后续重试因为查不到
 * committed identity 会再次成为 creator，破坏幂等不变量。因此这里宁可让本次请求确定性失败
 * （客户端可用同一 operationId 重试，重试会干净地重新建立权威 identity）。</p>
 *
 * <p>复用既有 canonical 错误码 {@link ApiErrorCode#INTERNAL_ERROR}（503/500 语义与
 * {@code retryable} 已由既有错误契约定义），不新增前端错误码，因此不需要 i18n 同步。</p>
 */
public class ProcessingOperationIdentityUnresolvedException extends ApiException {

    public ProcessingOperationIdentityUnresolvedException() {
        super(ApiErrorCode.INTERNAL_ERROR, "PROCESSING_OPERATION_IDENTITY_UNRESOLVED", Map.of());
    }
}

// 整页重载恢复出的接地阴影选择：必须同时绑定 reloadId 与恢复出来的 File。
// 只有当前 3D 场景文件和请求里的 File 是同一个对象时才允许应用；用户切到另一场、
// 恢复被取消或失败时，请求不会匹配新场景，接地阴影保持 OFF。
export interface ReplayShadowRequest {
  id: string
  file: File
  contactShadows: boolean
}

export function contactShadowOverrideFor(
  file: File | null | undefined,
  request: ReplayShadowRequest | null | undefined,
): boolean | undefined {
  if (!file || !request || !request.id || request.file !== file) return undefined
  return request.contactShadows
}

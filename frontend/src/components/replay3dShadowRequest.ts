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

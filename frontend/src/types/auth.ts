
export interface AuthClaims {
  sub?: string
  displayName?: string
  preferred_username?: string
  realm_access?: { roles?: string[] }
  [claim: string]: unknown
}

export type AuthInitMode = 'normal' | 'login-recovery'

export interface AuthProvider {
  readonly name: string
  readonly authenticated: boolean
  readonly tokenParsed: AuthClaims | null
  init(options?: { mode?: AuthInitMode }): Promise<void>
  token(): string
  login(redirectUri?: string): Promise<boolean | void>
  logout(redirectUri?: string): Promise<void>
  ensureToken(minValidity?: number): Promise<boolean>
  onAuthChanged(callback: () => void): () => void
}

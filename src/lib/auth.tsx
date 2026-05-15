import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import type { UserProfile } from './types'

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? ''
export const HAS_REAL_AUTH = Boolean(CLIENT_ID)

export const SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails',
  'https://www.googleapis.com/auth/classroom.profile.photos',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.appdata',
].join(' ')

interface AuthState {
  user: UserProfile | null
  accessToken: string | null
  isReady: boolean
  signIn: () => Promise<void>
  signOut: () => void
}

const AuthContext = createContext<AuthState | null>(null)

const STORAGE_KEY = 'notesanity:auth'

interface StoredAuth {
  user: UserProfile
  accessToken: string
  expiresAt: number
}

function loadStored(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredAuth
    if (parsed.expiresAt && parsed.expiresAt < Date.now()) return null
    return parsed
  } catch {
    return null
  }
}

function persist(value: StoredAuth | null) {
  if (!value) localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
}

declare global {
  interface Window {
    google?: any
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredAuth | null>(() => loadStored())
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const check = () => {
      if (cancelled) return
      if (!HAS_REAL_AUTH) { setIsReady(true); return }
      if (window.google?.accounts?.oauth2) { setIsReady(true); return }
      setTimeout(check, 100)
    }
    check()
    return () => { cancelled = true }
  }, [])

  const signIn = useCallback(async () => {
    if (!HAS_REAL_AUTH) throw new Error('Google client ID not configured (set VITE_GOOGLE_CLIENT_ID)')
    if (!window.google?.accounts?.oauth2) throw new Error('Google Identity Services not loaded yet')
    return new Promise<void>((resolve, reject) => {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (resp: any) => {
          if (resp.error) return reject(new Error(resp.error))
          const accessToken = resp.access_token as string
          const expiresAt = Date.now() + (resp.expires_in ?? 3600) * 1000
          try {
            const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${accessToken}` },
            }).then((r) => r.json())
            const user: UserProfile = {
              sub: info.sub,
              email: info.email,
              name: info.name,
              picture: info.picture,
            }
            const next = { user, accessToken, expiresAt }
            persist(next)
            setStored(next)
            resolve()
          } catch (e) { reject(e) }
        },
      })
      tokenClient.requestAccessToken({ prompt: 'consent' })
    })
  }, [])

  const signOut = useCallback(() => {
    if (stored?.accessToken && window.google?.accounts?.oauth2) {
      try { window.google.accounts.oauth2.revoke(stored.accessToken, () => {}) } catch {}
    }
    persist(null)
    setStored(null)
  }, [stored])

  const value: AuthState = useMemo(() => ({
    user: stored?.user ?? null,
    accessToken: stored?.accessToken ?? null,
    isReady,
    signIn,
    signOut,
  }), [stored, isReady, signIn, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

export function RequireAuth() {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/" replace state={{ from: location }} />
  return <Outlet />
}

/**
 * Utility function for refreshing Google OAuth tokens when needed.
 */

import { base44 } from '../../src/lib/base44-sdk'

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || ''
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''

interface OAuthGrant {
  id: string
  userId: string
  accessToken: string
  refreshToken?: string
  expiresAt?: string
}

export async function refreshTokenIfNeeded(grant: OAuthGrant): Promise<string> {
  // Check if token is expired or will expire in the next 5 minutes
  const expiresAt = grant.expiresAt ? new Date(grant.expiresAt) : new Date(0)
  const isExpired = expiresAt.getTime() - Date.now() < 5 * 60 * 1000

  if (!isExpired) {
    return grant.accessToken
  }

  if (!grant.refreshToken) {
    throw new Error('No refresh token available and access token expired')
  }

  // Refresh the token
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: grant.refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    throw new Error('Failed to refresh token')
  }

  const tokens = await response.json()
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  // Update the grant with new tokens
  await base44.entities.OAuthGrant.update(grant.id, {
    accessToken: tokens.access_token,
    expiresAt: newExpiresAt,
    // Google may issue a new refresh token
    ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
  })

  return tokens.access_token
}

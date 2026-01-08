/**
 * Handles the callback from Google's OAuth server after user authorization.
 * Exchanges the authorization code for access and refresh tokens,
 * stores them securely in the OAuthGrant entity.
 */

import { base44 } from '../src/lib/base44-sdk'

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || ''
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''
const REDIRECT_URI = Deno.env.get('GOOGLE_REDIRECT_URI') || ''

export default async function classroomCallback(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')

    if (error) {
      return new Response(JSON.stringify({ error: `Authorization denied: ${error}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!code || !state) {
      return new Response(JSON.stringify({ error: 'Missing code or state parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Decode and validate state
    let stateData: { userId: string; timestamp: number }
    try {
      stateData = JSON.parse(atob(state))
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid state parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Verify state is not too old (15 minutes)
    if (Date.now() - stateData.timestamp > 15 * 60 * 1000) {
      return new Response(JSON.stringify({ error: 'Authorization request expired' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error('Token exchange failed:', errorText)
      return new Response(JSON.stringify({ error: 'Failed to exchange authorization code' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const tokens = await tokenResponse.json()

    // Calculate expiration time
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // Store or update the OAuth grant
    const existingGrant = await base44.entities.OAuthGrant.list({
      filter: { userId: stateData.userId, provider: 'GOOGLE' },
    })

    if (existingGrant.length > 0) {
      // Update existing grant
      await base44.entities.OAuthGrant.update(existingGrant[0].id, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || existingGrant[0].refreshToken,
        scopes: tokens.scope.split(' '),
        expiresAt,
        revokedAt: null,
      })
    } else {
      // Create new grant
      await base44.entities.OAuthGrant.create({
        userId: stateData.userId,
        provider: 'GOOGLE',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        scopes: tokens.scope.split(' '),
        expiresAt,
      })
    }

    // Return success - frontend will close the popup
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error handling classroom callback:', error)
    return new Response(JSON.stringify({ error: 'Failed to complete authentication' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

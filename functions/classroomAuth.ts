/**
 * Initiates the Google OAuth 2.0 authorization flow for Classroom and Drive scopes.
 * Redirects the user to Google's authorization server.
 */

import { base44 } from '../src/lib/base44-sdk'

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || ''
const REDIRECT_URI = Deno.env.get('GOOGLE_REDIRECT_URI') || ''

const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ')

export default async function classroomAuth(request: Request): Promise<Response> {
  try {
    // Get the current user from the request context
    const user = await base44.auth.me()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Generate a state parameter for CSRF protection
    const state = btoa(JSON.stringify({
      userId: user.id,
      timestamp: Date.now(),
    }))

    // Build the authorization URL
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID)
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', SCOPES)
    authUrl.searchParams.set('access_type', 'offline')
    authUrl.searchParams.set('prompt', 'consent')
    authUrl.searchParams.set('state', state)

    return new Response(JSON.stringify({ authUrl: authUrl.toString() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error initiating classroom auth:', error)
    return new Response(JSON.stringify({ error: 'Failed to initiate authentication' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

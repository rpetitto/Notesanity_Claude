/**
 * Fetches a list of courses from the user's Google Classroom account.
 * Checks for OAuth authorization and handles token refreshing.
 */

import { base44 } from '../src/lib/base44-sdk'
import { refreshTokenIfNeeded } from './utils/tokenRefresh'

export default async function fetchClassroomCourses(request: Request): Promise<Response> {
  try {
    // Get the current user
    const user = await base44.auth.me()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get OAuth grant for the user
    const grants = await base44.entities.OAuthGrant.list({
      filter: { userId: user.id, provider: 'GOOGLE' },
    })

    if (grants.length === 0 || grants[0].revokedAt) {
      return new Response(JSON.stringify({
        error: 'Google authorization required',
        requiresAuth: true
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const grant = grants[0]

    // Refresh token if needed
    const accessToken = await refreshTokenIfNeeded(grant)

    // Fetch courses from Google Classroom
    const coursesResponse = await fetch(
      'https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&teacherId=me',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!coursesResponse.ok) {
      if (coursesResponse.status === 401) {
        return new Response(JSON.stringify({
          error: 'Google authorization expired',
          requiresAuth: true
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Classroom API error: ${coursesResponse.status}`)
    }

    const data = await coursesResponse.json()
    const courses = data.courses || []

    // Map to our expected format
    const mappedCourses = courses.map((course: any) => ({
      id: course.id,
      name: course.name,
      section: course.section,
      descriptionHeading: course.descriptionHeading,
      description: course.description,
      ownerId: course.ownerId,
      courseState: course.courseState,
      alternateLink: course.alternateLink,
    }))

    return new Response(JSON.stringify({ courses: mappedCourses }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error fetching classroom courses:', error)
    return new Response(JSON.stringify({ error: 'Failed to fetch courses' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

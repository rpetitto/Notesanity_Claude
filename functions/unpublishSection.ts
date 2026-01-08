/**
 * Unpublishes a section, making it no longer visible to students.
 */

import { base44 } from '../src/lib/base44-sdk'

interface UnpublishSectionRequest {
  sectionId: string
}

export default async function unpublishSection(request: Request): Promise<Response> {
  try {
    const user = await base44.auth.me()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body: UnpublishSectionRequest = await request.json()
    const { sectionId } = body

    // Get the section
    const section = await base44.entities.Section.get(sectionId)
    if (!section) {
      return new Response(JSON.stringify({ error: 'Section not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get the binder and verify ownership
    const binder = await base44.entities.Binder.get(section.binderId)
    if (!binder) {
      return new Response(JSON.stringify({ error: 'Binder not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Verify user is a teacher in this course
    const membership = await base44.entities.CourseMembership.list({
      filter: { courseId: binder.courseId, userId: user.id, roleInCourse: 'TEACHER' },
    })

    if (membership.length === 0) {
      return new Response(JSON.stringify({ error: 'Only teachers can unpublish sections' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Update section to unpublished
    await base44.entities.Section.update(sectionId, {
      published: false,
    })

    // Log audit event
    await base44.entities.AuditEvent.create({
      actorUserId: user.id,
      action: 'UPDATE',
      entityType: 'Section',
      entityId: sectionId,
      details: { action: 'unpublish', title: section.title },
    })

    return new Response(JSON.stringify({
      success: true,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error unpublishing section:', error)
    return new Response(JSON.stringify({ error: 'Failed to unpublish section' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

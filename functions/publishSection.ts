/**
 * Publishes a section to all students in a course.
 */

import { base44 } from '../src/lib/base44-sdk'

interface PublishSectionRequest {
  sectionId: string
}

export default async function publishSection(request: Request): Promise<Response> {
  try {
    const user = await base44.auth.me()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body: PublishSectionRequest = await request.json()
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
      return new Response(JSON.stringify({ error: 'Only teachers can publish sections' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Update section to published
    await base44.entities.Section.update(sectionId, {
      published: true,
    })

    // Get all students in the course
    const students = await base44.entities.CourseMembership.list({
      filter: { courseId: binder.courseId, roleInCourse: 'STUDENT', status: 'active' },
    })

    // Ensure each student has this section in their binder
    for (const student of students) {
      // Get or create student's binder
      let studentBinders = await base44.entities.Binder.list({
        filter: { courseId: binder.courseId, ownerUserId: student.userId },
      })

      if (studentBinders.length === 0) {
        const newBinder = await base44.entities.Binder.create({
          courseId: binder.courseId,
          ownerUserId: student.userId,
          name: binder.name,
          status: 'active',
        })
        studentBinders = [newBinder]
      }

      const studentBinder = studentBinders[0]

      // Check if student already has this section (by title or systemKey)
      const existingSections = await base44.entities.Section.list({
        filter: {
          binderId: studentBinder.id,
          ...(section.systemKey ? { systemKey: section.systemKey } : { title: section.title }),
        },
      })

      if (existingSections.length === 0) {
        // Create the section for the student
        await base44.entities.Section.create({
          binderId: studentBinder.id,
          title: section.title,
          orderIndex: section.orderIndex,
          isSystem: section.isSystem,
          systemKey: section.systemKey,
          published: true,
          origin: 'APP',
          managedByApp: true,
          color: section.color,
        })
      }
    }

    // Log audit event
    await base44.entities.AuditEvent.create({
      actorUserId: user.id,
      action: 'UPDATE',
      entityType: 'Section',
      entityId: sectionId,
      details: { action: 'publish', title: section.title },
    })

    return new Response(JSON.stringify({
      success: true,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error publishing section:', error)
    return new Response(JSON.stringify({ error: 'Failed to publish section' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

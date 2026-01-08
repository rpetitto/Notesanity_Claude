/**
 * Distributes a source page (owned by a teacher) to multiple students.
 * Supports two modes: REFERENCE (sharing view-only access) or TEMPLATE_COPY (creating a copy for each student).
 */

import { base44 } from '../src/lib/base44-sdk'
import { refreshTokenIfNeeded } from './utils/tokenRefresh'

interface DistributePageRequest {
  pageId: string
  courseId: string
  distributionType: 'REFERENCE' | 'TEMPLATE_COPY'
  targetSectionKey?: string
  notifyStudents?: boolean
}

export default async function distributePage(request: Request): Promise<Response> {
  try {
    const user = await base44.auth.me()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body: DistributePageRequest = await request.json()
    const {
      pageId,
      courseId,
      distributionType,
      targetSectionKey = 'GENERAL',
      notifyStudents = true
    } = body

    // Get the source page
    const page = await base44.entities.Page.get(pageId)
    if (!page) {
      return new Response(JSON.stringify({ error: 'Page not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Verify user is the teacher/owner
    const membership = await base44.entities.CourseMembership.list({
      filter: { courseId, userId: user.id, roleInCourse: 'TEACHER' },
    })

    if (membership.length === 0) {
      return new Response(JSON.stringify({ error: 'Only teachers can distribute pages' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get OAuth grant
    const grants = await base44.entities.OAuthGrant.list({
      filter: { userId: user.id, provider: 'GOOGLE' },
    })

    if (grants.length === 0) {
      return new Response(JSON.stringify({
        error: 'Google authorization required',
        requiresAuth: true
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const accessToken = await refreshTokenIfNeeded(grants[0])

    // Get all students in the course
    const students = await base44.entities.CourseMembership.list({
      filter: { courseId, roleInCourse: 'STUDENT', status: 'active' },
    })

    // Create distribution event
    const distributionEvent = await base44.entities.DistributionEvent.create({
      courseId,
      teacherUserId: user.id,
      sourcePageId: pageId,
      sourceDriveFileId: page.driveFileId,
      distributionType,
      targetSectionKey,
      notifyStudents,
    })

    const results = {
      successful: 0,
      failed: 0,
      errors: [] as string[],
    }

    // Process each student
    for (const student of students) {
      try {
        // Get student's binder for this course
        const studentBinders = await base44.entities.Binder.list({
          filter: { courseId, ownerUserId: student.userId },
        })

        let studentBinder = studentBinders[0]
        if (!studentBinder) {
          // Create binder for student if it doesn't exist
          studentBinder = await base44.entities.Binder.create({
            courseId,
            ownerUserId: student.userId,
            name: page.title,
            status: 'active',
          })
        }

        // Find target section in student's binder
        const targetSections = await base44.entities.Section.list({
          filter: {
            binderId: studentBinder.id,
            ...(targetSectionKey === 'GENERAL' || targetSectionKey === 'ASSIGNMENTS'
              ? { systemKey: targetSectionKey }
              : { id: targetSectionKey }),
          },
        })

        let targetSection = targetSections[0]
        if (!targetSection) {
          // Use or create general section
          const generalSections = await base44.entities.Section.list({
            filter: { binderId: studentBinder.id, systemKey: 'GENERAL' },
          })
          targetSection = generalSections[0]
        }

        if (!targetSection) {
          results.errors.push(`No target section for student ${student.userId}`)
          results.failed++
          continue
        }

        let studentPageId: string
        let studentDriveItemId: string | undefined

        if (distributionType === 'REFERENCE' && page.driveFileId) {
          // Share view-only access to the file
          await fetch(
            `https://www.googleapis.com/drive/v3/files/${page.driveFileId}/permissions`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                type: 'user',
                role: 'reader',
                emailAddress: student.userId, // Assuming userId is email
              }),
            }
          )

          // Create page reference for student
          const studentPage = await base44.entities.Page.create({
            binderId: studentBinder.id,
            sectionId: targetSection.id,
            title: page.title,
            pageType: page.pageType,
            originType: 'TEACHER_DISTRIBUTED',
            distributionType: 'REFERENCE',
            distributionStatus: 'viewOnlyDistributed',
            origin: 'APP',
            managedByApp: true,
            pageSourceId: pageId,
            driveFileId: page.driveFileId,
            driveMimeType: page.driveMimeType,
            thumbnailUrl: page.thumbnailUrl,
            ownerUserId: student.userId,
          })

          studentPageId = studentPage.id
          studentDriveItemId = page.driveFileId

        } else if (distributionType === 'TEMPLATE_COPY' && page.driveFileId) {
          // Copy the file for the student
          const copyResponse = await fetch(
            `https://www.googleapis.com/drive/v3/files/${page.driveFileId}/copy`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                name: page.title,
              }),
            }
          )

          if (!copyResponse.ok) {
            throw new Error('Failed to copy Drive file')
          }

          const copiedFile = await copyResponse.json()

          // Transfer ownership to student
          await fetch(
            `https://www.googleapis.com/drive/v3/files/${copiedFile.id}/permissions`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                type: 'user',
                role: 'writer',
                emailAddress: student.userId,
              }),
            }
          )

          // Create page for student
          const studentPage = await base44.entities.Page.create({
            binderId: studentBinder.id,
            sectionId: targetSection.id,
            title: page.title,
            pageType: page.pageType,
            originType: 'TEACHER_DISTRIBUTED',
            distributionType: 'TEMPLATE_COPY',
            distributionStatus: 'copyDistributed',
            origin: 'APP',
            managedByApp: true,
            pageSourceId: pageId,
            driveFileId: copiedFile.id,
            driveMimeType: page.driveMimeType,
            ownerUserId: student.userId,
          })

          studentPageId = studentPage.id
          studentDriveItemId = copiedFile.id

        } else {
          // For non-Drive pages (Canvas, etc.)
          const studentPage = await base44.entities.Page.create({
            binderId: studentBinder.id,
            sectionId: targetSection.id,
            title: page.title,
            pageType: page.pageType,
            originType: 'TEACHER_DISTRIBUTED',
            distributionType,
            distributionStatus: distributionType === 'REFERENCE' ? 'viewOnlyDistributed' : 'copyDistributed',
            origin: 'APP',
            managedByApp: true,
            pageSourceId: pageId,
            ownerUserId: student.userId,
          })

          studentPageId = studentPage.id
        }

        // Create distribution instance
        await base44.entities.DistributionInstance.create({
          distributionEventId: distributionEvent.id,
          studentUserId: student.userId,
          studentPageId,
          studentDriveItemId,
          status: 'CREATED',
        })

        // Create notification for student
        if (notifyStudents) {
          await base44.entities.Notification.create({
            recipientUserId: student.userId,
            type: 'PAGE_DISTRIBUTED',
            title: 'New page shared',
            message: `Your teacher shared "${page.title}" with you.`,
            entityType: 'Page',
            entityId: studentPageId,
          })
        }

        results.successful++

      } catch (err) {
        results.errors.push(`Failed for student ${student.userId}: ${err}`)
        results.failed++

        // Record failed distribution instance
        await base44.entities.DistributionInstance.create({
          distributionEventId: distributionEvent.id,
          studentUserId: student.userId,
          status: 'FAILED',
          errorMessage: String(err),
        })
      }
    }

    // Update source page distribution status
    await base44.entities.Page.update(pageId, {
      distributionStatus: distributionType === 'REFERENCE' ? 'viewOnlyDistributed' : 'copyDistributed',
    })

    // Log audit event
    await base44.entities.AuditEvent.create({
      actorUserId: user.id,
      action: 'DISTRIBUTE',
      entityType: 'Page',
      entityId: pageId,
      details: { distributionType, courseId, results },
    })

    return new Response(JSON.stringify({
      success: true,
      distributionEventId: distributionEvent.id,
      ...results,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error distributing page:', error)
    return new Response(JSON.stringify({ error: 'Failed to distribute page' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

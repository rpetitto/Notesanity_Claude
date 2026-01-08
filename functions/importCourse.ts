/**
 * Imports a selected Google Classroom course into the application.
 * Creates Course, Binder, Portfolio, Section, and CourseMembership entities,
 * and sets up initial Google Drive folders.
 */

import { base44 } from '../src/lib/base44-sdk'
import { refreshTokenIfNeeded } from './utils/tokenRefresh'

interface ImportCourseRequest {
  googleCourseId: string
  courseName: string
  courseSection?: string
}

export default async function importCourse(request: Request): Promise<Response> {
  try {
    const user = await base44.auth.me()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body: ImportCourseRequest = await request.json()
    const { googleCourseId, courseName, courseSection } = body

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

    const grant = grants[0]
    const accessToken = await refreshTokenIfNeeded(grant)

    // Check if course is already imported
    const existingCourses = await base44.entities.Course.list({
      filter: { googleClassroomCourseId: googleCourseId },
    })

    if (existingCourses.length > 0) {
      return new Response(JSON.stringify({
        error: 'Course already imported',
        courseId: existingCourses[0].id
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Create Google Drive folder for the binder
    const driveResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `Notebook Binder - ${courseName}`,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    })

    if (!driveResponse.ok) {
      throw new Error('Failed to create Drive folder')
    }

    const driveFolder = await driveResponse.json()

    // Create the Course entity
    const course = await base44.entities.Course.create({
      googleClassroomCourseId: googleCourseId,
      name: courseName,
      section: courseSection,
      status: 'active',
      ownerId: user.id,
      classroomFolderId: driveFolder.id,
    })

    // Get or create Portfolio for the user
    let portfolio = await base44.entities.Portfolio.list({
      filter: { ownerUserId: user.id },
    })

    let portfolioId: string
    if (portfolio.length === 0) {
      const newPortfolio = await base44.entities.Portfolio.create({
        ownerUserId: user.id,
        visibility: 'DOMAIN_ONLY',
        name: `${user.full_name}'s Portfolio`,
      })
      portfolioId = newPortfolio.id
    } else {
      portfolioId = portfolio[0].id
    }

    // Create the Binder entity
    const binder = await base44.entities.Binder.create({
      portfolioId,
      courseId: course.id,
      ownerUserId: user.id,
      name: courseName,
      status: 'active',
    })

    // Create default sections (General and Assignments)
    const generalSection = await base44.entities.Section.create({
      binderId: binder.id,
      title: 'General',
      orderIndex: 0,
      isSystem: true,
      systemKey: 'GENERAL',
      published: true,
      origin: 'APP',
      managedByApp: true,
    })

    const assignmentsSection = await base44.entities.Section.create({
      binderId: binder.id,
      title: 'Assignments',
      orderIndex: 1,
      isSystem: true,
      systemKey: 'ASSIGNMENTS',
      published: true,
      origin: 'APP',
      managedByApp: true,
    })

    // Create Drive folders for sections
    for (const section of [generalSection, assignmentsSection]) {
      const sectionFolderResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: section.title,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [driveFolder.id],
        }),
      })

      if (sectionFolderResponse.ok) {
        const sectionFolder = await sectionFolderResponse.json()
        await base44.entities.Section.update(section.id, {
          driveFolderId: sectionFolder.id,
        })

        // Create DriveFolderMap
        await base44.entities.DriveFolderMap.create({
          ownerUserId: user.id,
          binderId: binder.id,
          sectionId: section.id,
          folderType: 'SECTION_FOLDER',
          driveFolderId: sectionFolder.id,
          parentDriveFolderId: driveFolder.id,
        })
      }
    }

    // Create DriveFolderMap for binder root
    await base44.entities.DriveFolderMap.create({
      ownerUserId: user.id,
      binderId: binder.id,
      folderType: 'BINDER_ROOT',
      driveFolderId: driveFolder.id,
    })

    // Create CourseMembership for the teacher
    await base44.entities.CourseMembership.create({
      courseId: course.id,
      userId: user.id,
      roleInCourse: 'TEACHER',
      status: 'active',
    })

    // Fetch and import students from Google Classroom
    try {
      const studentsResponse = await fetch(
        `https://classroom.googleapis.com/v1/courses/${googleCourseId}/students`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      )

      if (studentsResponse.ok) {
        const studentsData = await studentsResponse.json()
        const students = studentsData.students || []

        for (const student of students) {
          await base44.entities.CourseMembership.create({
            courseId: course.id,
            userId: student.userId,
            roleInCourse: 'STUDENT',
            googleClassroomUserId: student.userId,
            status: 'active',
          })
        }
      }
    } catch (err) {
      console.warn('Failed to import students:', err)
    }

    // Log audit event
    await base44.entities.AuditEvent.create({
      actorUserId: user.id,
      actorEmail: user.email,
      action: 'IMPORT',
      entityType: 'Course',
      entityId: course.id,
      details: { googleCourseId, courseName },
    })

    return new Response(JSON.stringify({
      success: true,
      courseId: course.id,
      binderId: binder.id,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error importing course:', error)
    return new Response(JSON.stringify({ error: 'Failed to import course' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

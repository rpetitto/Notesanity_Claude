/**
 * Recalls a distributed page, revoking access from students.
 */

import { base44 } from '../src/lib/base44-sdk'
import { refreshTokenIfNeeded } from './utils/tokenRefresh'

interface RecallPageRequest {
  pageId: string
}

export default async function recallPage(request: Request): Promise<Response> {
  try {
    const user = await base44.auth.me()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body: RecallPageRequest = await request.json()
    const { pageId } = body

    // Get the page
    const page = await base44.entities.Page.get(pageId)
    if (!page) {
      return new Response(JSON.stringify({ error: 'Page not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Verify user owns this page
    if (page.ownerUserId !== user.id) {
      return new Response(JSON.stringify({ error: 'Not authorized to recall this page' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Check if page is distributed
    if (page.distributionStatus === 'private') {
      return new Response(JSON.stringify({ error: 'Page is not distributed' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get OAuth grant
    const grants = await base44.entities.OAuthGrant.list({
      filter: { userId: user.id, provider: 'GOOGLE' },
    })

    let accessToken: string | null = null
    if (grants.length > 0) {
      accessToken = await refreshTokenIfNeeded(grants[0])
    }

    // Find all distribution instances for this page
    const distributionEvents = await base44.entities.DistributionEvent.list({
      filter: { sourcePageId: pageId },
    })

    const results = {
      successful: 0,
      failed: 0,
      errors: [] as string[],
    }

    for (const event of distributionEvents) {
      const instances = await base44.entities.DistributionInstance.list({
        filter: { distributionEventId: event.id, status: 'CREATED' },
      })

      for (const instance of instances) {
        try {
          // If it was a reference distribution and we have Drive access, revoke permissions
          if (event.distributionType === 'REFERENCE' && page.driveFileId && accessToken) {
            // List permissions on the file
            const permissionsResponse = await fetch(
              `https://www.googleapis.com/drive/v3/files/${page.driveFileId}/permissions`,
              {
                headers: { Authorization: `Bearer ${accessToken}` },
              }
            )

            if (permissionsResponse.ok) {
              const permissionsData = await permissionsResponse.json()

              // Find and delete student's permission
              for (const permission of permissionsData.permissions || []) {
                if (permission.emailAddress === instance.studentUserId) {
                  await fetch(
                    `https://www.googleapis.com/drive/v3/files/${page.driveFileId}/permissions/${permission.id}`,
                    {
                      method: 'DELETE',
                      headers: { Authorization: `Bearer ${accessToken}` },
                    }
                  )
                }
              }
            }
          }

          // Delete the student's page
          if (instance.studentPageId) {
            await base44.entities.Page.update(instance.studentPageId, {
              deletedAt: new Date().toISOString(),
              deletedByUserId: user.id,
            })
          }

          // Create notification for student
          await base44.entities.Notification.create({
            recipientUserId: instance.studentUserId,
            type: 'PAGE_UPDATED',
            title: 'Page recalled',
            message: `"${page.title}" has been recalled by your teacher.`,
            entityType: 'Page',
            entityId: instance.studentPageId || pageId,
          })

          results.successful++

        } catch (err) {
          results.errors.push(`Failed for student ${instance.studentUserId}: ${err}`)
          results.failed++
        }
      }
    }

    // Update page distribution status
    await base44.entities.Page.update(pageId, {
      distributionStatus: 'private',
    })

    // Log audit event
    await base44.entities.AuditEvent.create({
      actorUserId: user.id,
      action: 'UPDATE',
      entityType: 'Page',
      entityId: pageId,
      details: { action: 'recall', results },
    })

    return new Response(JSON.stringify({
      success: true,
      ...results,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error recalling page:', error)
    return new Response(JSON.stringify({ error: 'Failed to recall page' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

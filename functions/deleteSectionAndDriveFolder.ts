/**
 * "Soft deletes" a section in the application by marking it deletedAt
 * and renames the corresponding Google Drive folder to indicate it's removed.
 */

import { base44 } from '../src/lib/base44-sdk'
import { refreshTokenIfNeeded } from './utils/tokenRefresh'

interface DeleteSectionRequest {
  sectionId: string
}

export default async function deleteSectionAndDriveFolder(request: Request): Promise<Response> {
  try {
    const user = await base44.auth.me()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body: DeleteSectionRequest = await request.json()
    const { sectionId } = body

    // Get the section
    const section = await base44.entities.Section.get(sectionId)
    if (!section) {
      return new Response(JSON.stringify({ error: 'Section not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Prevent deletion of system sections
    if (section.isSystem) {
      return new Response(JSON.stringify({ error: 'Cannot delete system sections' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get the binder and verify ownership
    const binder = await base44.entities.Binder.get(section.binderId)
    if (!binder || binder.ownerUserId !== user.id) {
      return new Response(JSON.stringify({ error: 'Not authorized to delete this section' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Rename Drive folder if it exists
    if (section.driveFolderId) {
      const grants = await base44.entities.OAuthGrant.list({
        filter: { userId: user.id, provider: 'GOOGLE' },
      })

      if (grants.length > 0) {
        try {
          const accessToken = await refreshTokenIfNeeded(grants[0])

          // Rename the Drive folder to indicate deletion
          await fetch(`https://www.googleapis.com/drive/v3/files/${section.driveFolderId}`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: `_DELETED_${section.title}_${Date.now()}`,
            }),
          })
        } catch (err) {
          console.warn('Failed to rename Drive folder:', err)
        }
      }
    }

    // Soft delete the section
    await base44.entities.Section.update(sectionId, {
      deletedAt: new Date().toISOString(),
    })

    // Soft delete all pages in this section
    const pages = await base44.entities.Page.list({
      filter: { sectionId, deletedAt: null },
    })

    for (const page of pages) {
      await base44.entities.Page.update(page.id, {
        deletedAt: new Date().toISOString(),
        deletedByUserId: user.id,
      })
    }

    // Soft delete all folders in this section
    const folders = await base44.entities.Folder.list({
      filter: { sectionId, deletedAt: null },
    })

    for (const folder of folders) {
      await base44.entities.Folder.update(folder.id, {
        deletedAt: new Date().toISOString(),
      })
    }

    // Log audit event
    await base44.entities.AuditEvent.create({
      actorUserId: user.id,
      action: 'DELETE',
      entityType: 'Section',
      entityId: sectionId,
      details: { title: section.title, binderId: section.binderId },
    })

    return new Response(JSON.stringify({
      success: true,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error deleting section:', error)
    return new Response(JSON.stringify({ error: 'Failed to delete section' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

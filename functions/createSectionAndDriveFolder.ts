/**
 * Creates a new section (tab) within a binder and a corresponding Google Drive folder.
 */

import { base44 } from '../src/lib/base44-sdk'
import { refreshTokenIfNeeded } from './utils/tokenRefresh'

interface CreateSectionRequest {
  binderId: string
  title: string
  color?: string
}

export default async function createSectionAndDriveFolder(request: Request): Promise<Response> {
  try {
    const user = await base44.auth.me()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body: CreateSectionRequest = await request.json()
    const { binderId, title, color } = body

    // Validate binder exists and user owns it
    const binder = await base44.entities.Binder.get(binderId)
    if (!binder) {
      return new Response(JSON.stringify({ error: 'Binder not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (binder.ownerUserId !== user.id) {
      return new Response(JSON.stringify({ error: 'Not authorized to modify this binder' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get existing sections to determine orderIndex
    const existingSections = await base44.entities.Section.list({
      filter: { binderId, deletedAt: null },
    })

    // Get OAuth grant for Drive operations
    const grants = await base44.entities.OAuthGrant.list({
      filter: { userId: user.id, provider: 'GOOGLE' },
    })

    let driveFolderId: string | undefined

    if (grants.length > 0) {
      try {
        const accessToken = await refreshTokenIfNeeded(grants[0])

        // Get the binder's root Drive folder
        const folderMaps = await base44.entities.DriveFolderMap.list({
          filter: { binderId, folderType: 'BINDER_ROOT' },
        })

        if (folderMaps.length > 0) {
          // Create folder in Google Drive
          const driveResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: title,
              mimeType: 'application/vnd.google-apps.folder',
              parents: [folderMaps[0].driveFolderId],
            }),
          })

          if (driveResponse.ok) {
            const driveFolder = await driveResponse.json()
            driveFolderId = driveFolder.id
          }
        }
      } catch (err) {
        console.warn('Failed to create Drive folder:', err)
      }
    }

    // Create the section entity
    const section = await base44.entities.Section.create({
      binderId,
      title,
      orderIndex: existingSections.length,
      isSystem: false,
      published: false,
      origin: 'APP',
      managedByApp: true,
      driveFolderId,
      color,
    })

    // Create DriveFolderMap if Drive folder was created
    if (driveFolderId) {
      const folderMaps = await base44.entities.DriveFolderMap.list({
        filter: { binderId, folderType: 'BINDER_ROOT' },
      })

      await base44.entities.DriveFolderMap.create({
        ownerUserId: user.id,
        binderId,
        sectionId: section.id,
        folderType: 'SECTION_FOLDER',
        driveFolderId,
        parentDriveFolderId: folderMaps[0]?.driveFolderId,
      })
    }

    // Log audit event
    await base44.entities.AuditEvent.create({
      actorUserId: user.id,
      action: 'CREATE',
      entityType: 'Section',
      entityId: section.id,
      details: { title, binderId },
    })

    return new Response(JSON.stringify({
      success: true,
      section,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error creating section:', error)
    return new Response(JSON.stringify({ error: 'Failed to create section' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

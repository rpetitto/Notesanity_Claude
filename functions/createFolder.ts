/**
 * Creates a new folder entity in the app's database and a corresponding folder in Google Drive.
 */

import { base44 } from '../src/lib/base44-sdk'
import { refreshTokenIfNeeded } from './utils/tokenRefresh'

interface CreateFolderRequest {
  binderId: string
  sectionId: string
  parentFolderId?: string
  title: string
}

export default async function createFolder(request: Request): Promise<Response> {
  try {
    const user = await base44.auth.me()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body: CreateFolderRequest = await request.json()
    const { binderId, sectionId, parentFolderId, title } = body

    // Validate binder exists
    const binder = await base44.entities.Binder.get(binderId)
    if (!binder) {
      return new Response(JSON.stringify({ error: 'Binder not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Validate section exists
    const section = await base44.entities.Section.get(sectionId)
    if (!section) {
      return new Response(JSON.stringify({ error: 'Section not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get OAuth grant for Drive operations
    const grants = await base44.entities.OAuthGrant.list({
      filter: { userId: user.id, provider: 'GOOGLE' },
    })

    let driveFolderId: string | undefined

    if (grants.length > 0) {
      try {
        const accessToken = await refreshTokenIfNeeded(grants[0])

        // Determine parent Drive folder
        let parentDriveFolderId = section.driveFolderId
        if (parentFolderId) {
          const parentFolder = await base44.entities.Folder.get(parentFolderId)
          if (parentFolder?.driveFolderId) {
            parentDriveFolderId = parentFolder.driveFolderId
          }
        }

        if (parentDriveFolderId) {
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
              parents: [parentDriveFolderId],
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

    // Get existing folders to determine orderIndex
    const existingFolders = await base44.entities.Folder.list({
      filter: { sectionId, parentFolderId: parentFolderId || null },
    })

    // Create the folder entity
    const folder = await base44.entities.Folder.create({
      binderId,
      sectionId,
      parentFolderId,
      title,
      orderIndex: existingFolders.length,
      driveFolderId,
      ownerUserId: user.id,
      origin: 'APP',
    })

    // Log audit event
    await base44.entities.AuditEvent.create({
      actorUserId: user.id,
      action: 'CREATE',
      entityType: 'Folder',
      entityId: folder.id,
      details: { title, sectionId },
    })

    return new Response(JSON.stringify({
      success: true,
      folder,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error creating folder:', error)
    return new Response(JSON.stringify({ error: 'Failed to create folder' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

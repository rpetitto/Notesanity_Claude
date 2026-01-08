/**
 * Synchronizes the current binder with its corresponding Google Drive folder.
 * Ensures consistency between the app's data model and Google Drive.
 */

import { base44 } from '../src/lib/base44-sdk'
import { refreshTokenIfNeeded } from './utils/tokenRefresh'

interface SyncDriveRequest {
  binderId: string
}

export default async function syncDrive(request: Request): Promise<Response> {
  try {
    const user = await base44.auth.me()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body: SyncDriveRequest = await request.json()
    const { binderId } = body

    // Get the binder
    const binder = await base44.entities.Binder.get(binderId)
    if (!binder) {
      return new Response(JSON.stringify({ error: 'Binder not found' }), {
        status: 404,
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

    // Get the binder's root Drive folder
    const folderMaps = await base44.entities.DriveFolderMap.list({
      filter: { binderId, folderType: 'BINDER_ROOT' },
    })

    if (folderMaps.length === 0) {
      return new Response(JSON.stringify({ error: 'Drive folder not found for binder' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const rootFolderId = folderMaps[0].driveFolderId

    // Get all sections for this binder
    const sections = await base44.entities.Section.list({
      filter: { binderId, deletedAt: null },
    })

    const syncResults = {
      pagesCreated: 0,
      pagesUpdated: 0,
      foldersCreated: 0,
      errors: [] as string[],
    }

    // Sync each section
    for (const section of sections) {
      if (!section.driveFolderId) continue

      try {
        // Fetch files from Drive folder
        const filesResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files?q='${section.driveFolderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType,thumbnailLink,modifiedTime)`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        )

        if (!filesResponse.ok) continue

        const filesData = await filesResponse.json()
        const driveFiles = filesData.files || []

        // Get existing pages for this section
        const existingPages = await base44.entities.Page.list({
          filter: { sectionId: section.id, deletedAt: null },
        })

        const existingDriveFileIds = new Set(
          existingPages.filter(p => p.driveFileId).map(p => p.driveFileId)
        )

        // Process each Drive file
        for (const file of driveFiles) {
          if (existingDriveFileIds.has(file.id)) {
            // Update existing page
            const existingPage = existingPages.find(p => p.driveFileId === file.id)
            if (existingPage) {
              await base44.entities.Page.update(existingPage.id, {
                title: file.name,
                thumbnailUrl: file.thumbnailLink,
              })
              syncResults.pagesUpdated++
            }
          } else if (file.mimeType !== 'application/vnd.google-apps.folder') {
            // Create new page for discovered Drive file
            const page = await base44.entities.Page.create({
              binderId,
              sectionId: section.id,
              title: file.name,
              pageType: 'DRIVE_FILE',
              originType: 'DRIVE_DISCOVERED',
              distributionStatus: 'private',
              origin: 'DRIVE',
              managedByApp: false,
              driveFileId: file.id,
              driveMimeType: file.mimeType,
              thumbnailUrl: file.thumbnailLink,
              ownerUserId: user.id,
              orderIndex: existingPages.length + syncResults.pagesCreated,
            })

            // Create DriveItemMap
            await base44.entities.DriveItemMap.create({
              ownerUserId: user.id,
              pageId: page.id,
              sectionId: section.id,
              itemType: 'FILE',
              driveItemId: file.id,
              parentDriveFolderId: section.driveFolderId,
              origin: 'DRIVE',
              lastSeenAt: new Date().toISOString(),
            })

            syncResults.pagesCreated++
          }
        }
      } catch (err) {
        syncResults.errors.push(`Failed to sync section ${section.title}: ${err}`)
      }
    }

    // Update binder sync timestamp
    await base44.entities.Binder.update(binderId, {
      lastDriveSyncAt: new Date().toISOString(),
      lastDriveSyncError: syncResults.errors.length > 0 ? syncResults.errors.join('; ') : null,
    })

    // Log audit event
    await base44.entities.AuditEvent.create({
      actorUserId: user.id,
      action: 'SYNC',
      entityType: 'Binder',
      entityId: binderId,
      details: syncResults,
    })

    return new Response(JSON.stringify({
      success: true,
      ...syncResults,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error syncing Drive:', error)
    return new Response(JSON.stringify({ error: 'Failed to sync with Drive' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

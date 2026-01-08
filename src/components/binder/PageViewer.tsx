import { ExternalLink, MessageSquare, Maximize2, Share2, MoreHorizontal } from 'lucide-react'
import type { Page } from '@/types'
import { cn } from '@/lib/utils'

interface PageViewerProps {
  page: Page | null
  isTeacher: boolean
  onShowComments: () => void
  showingComments: boolean
  courseId: string
}

export default function PageViewer({
  page,
  isTeacher,
  onShowComments,
  showingComments,
  courseId,
}: PageViewerProps) {
  if (!page) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-variant/30">
        <div className="text-center text-on-surface-variant">
          <div className="w-24 h-24 rounded-full bg-surface-container-high flex items-center justify-center mx-auto mb-6">
            <svg className="w-12 h-12 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-title-large mb-2">No page selected</p>
          <p className="text-body-medium">Select a page from the list to view its content</p>
        </div>
      </div>
    )
  }

  const openInDrive = () => {
    if (page.driveFileId) {
      window.open(`https://drive.google.com/file/d/${page.driveFileId}/view`, '_blank')
    }
  }

  const openFullscreen = () => {
    if (page.driveFileId) {
      const embedUrl = getEmbedUrl(page)
      if (embedUrl) {
        window.open(embedUrl, '_blank')
      }
    }
  }

  const getEmbedUrl = (page: Page): string | null => {
    if (!page.driveFileId) return null

    switch (page.driveMimeType) {
      case 'application/vnd.google-apps.document':
        return `https://docs.google.com/document/d/${page.driveFileId}/preview`
      case 'application/vnd.google-apps.spreadsheet':
        return `https://docs.google.com/spreadsheets/d/${page.driveFileId}/preview`
      case 'application/vnd.google-apps.presentation':
        return `https://docs.google.com/presentation/d/${page.driveFileId}/preview`
      case 'application/pdf':
        return `https://drive.google.com/file/d/${page.driveFileId}/preview`
      default:
        return `https://drive.google.com/file/d/${page.driveFileId}/preview`
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Page Header - Material v3 top app bar style */}
      <header className="h-14 border-b border-outline-variant flex items-center px-4 gap-3 bg-surface-container-low">
        <h2 className="font-medium text-title-medium text-on-surface truncate">{page.title}</h2>

        {/* Distribution Badge - Material v3 chips */}
        {page.distributionStatus !== 'private' && (
          <span className={cn(
            "px-3 py-1 text-label-medium rounded-small",
            page.distributionStatus === 'viewOnlyDistributed'
              ? "bg-primary-container text-on-primary-container"
              : "bg-tertiary-container text-on-tertiary-container"
          )}>
            {page.distributionStatus === 'viewOnlyDistributed' ? 'View-only' : 'Copy'}
          </span>
        )}

        <div className="flex-1" />

        {/* Actions - Material v3 icon buttons */}
        <div className="flex items-center gap-1">
          {page.driveFileId && (
            <>
              <button
                onClick={openInDrive}
                className="btn-icon"
                title="Open in Google Drive"
              >
                <ExternalLink className="h-5 w-5" />
              </button>
              <button
                onClick={openFullscreen}
                className="btn-icon"
                title="Fullscreen"
              >
                <Maximize2 className="h-5 w-5" />
              </button>
            </>
          )}

          <button
            onClick={onShowComments}
            className={cn(
              "btn-icon",
              showingComments && "bg-secondary-container text-on-secondary-container"
            )}
            title="Comments"
          >
            <MessageSquare className="h-5 w-5" />
          </button>

          {isTeacher && page.distributionStatus === 'private' && (
            <button
              className="btn-icon"
              title="Share/Distribute"
            >
              <Share2 className="h-5 w-5" />
            </button>
          )}

          <button
            className="btn-icon"
            title="More options"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Page Content */}
      <div className="flex-1 overflow-hidden bg-surface-variant/20">
        {page.pageType === 'DRIVE_FILE' && page.driveFileId ? (
          <iframe
            src={getEmbedUrl(page) || ''}
            className="w-full h-full border-0"
            title={page.title}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : page.pageType === 'CANVAS' ? (
          <div className="flex-1 h-full flex items-center justify-center">
            <div className="text-center text-on-surface-variant">
              <div className="w-24 h-24 rounded-full bg-primary-container flex items-center justify-center mx-auto mb-6">
                <svg className="w-12 h-12 text-on-primary-container" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </div>
              <p className="text-title-large mb-2 text-on-surface">Canvas Drawing</p>
              <p className="text-body-medium mb-6">Click to open the drawing editor</p>
              <button className="btn-filled">
                Open Canvas Editor
              </button>
            </div>
          </div>
        ) : page.pageType === 'EMBED' ? (
          <div className="flex-1 h-full flex items-center justify-center">
            <div className="text-center text-on-surface-variant">
              <div className="w-24 h-24 rounded-full bg-tertiary-container flex items-center justify-center mx-auto mb-6">
                <svg className="w-12 h-12 text-on-tertiary-container" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </div>
              <p className="text-title-large mb-2 text-on-surface">Embedded Content</p>
              <p className="text-body-medium">This content is embedded from an external source</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 h-full flex items-center justify-center">
            <div className="text-center text-on-surface-variant">
              <div className="w-24 h-24 rounded-full bg-surface-container-highest flex items-center justify-center mx-auto mb-6">
                <svg className="w-12 h-12 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <p className="text-title-large mb-2 text-on-surface">Content Preview</p>
              <p className="text-body-medium">Preview not available for this page type</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

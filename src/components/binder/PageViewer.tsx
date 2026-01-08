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
      <div className="flex-1 flex items-center justify-center bg-muted/30">
        <div className="text-center text-muted-foreground">
          <p className="text-lg mb-2">No page selected</p>
          <p className="text-sm">Select a page from the list to view its content</p>
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
      {/* Page Header */}
      <header className="h-12 border-b flex items-center px-4 gap-3 bg-card">
        <h2 className="font-medium truncate">{page.title}</h2>

        {/* Distribution Badge */}
        {page.distributionStatus !== 'private' && (
          <span className={cn(
            "px-2 py-0.5 text-xs rounded",
            page.distributionStatus === 'viewOnlyDistributed'
              ? "bg-blue-100 text-blue-700"
              : "bg-green-100 text-green-700"
          )}>
            {page.distributionStatus === 'viewOnlyDistributed' ? 'View-only' : 'Copy'}
          </span>
        )}

        <div className="flex-1" />

        {/* Actions */}
        <div className="flex items-center gap-1">
          {page.driveFileId && (
            <>
              <button
                onClick={openInDrive}
                className="p-2 hover:bg-accent rounded-md transition-colors"
                title="Open in Google Drive"
              >
                <ExternalLink className="h-4 w-4" />
              </button>
              <button
                onClick={openFullscreen}
                className="p-2 hover:bg-accent rounded-md transition-colors"
                title="Fullscreen"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            </>
          )}

          <button
            onClick={onShowComments}
            className={cn(
              "p-2 rounded-md transition-colors",
              showingComments ? "bg-primary text-white" : "hover:bg-accent"
            )}
            title="Comments"
          >
            <MessageSquare className="h-4 w-4" />
          </button>

          {isTeacher && page.distributionStatus === 'private' && (
            <button
              className="p-2 hover:bg-accent rounded-md transition-colors"
              title="Share/Distribute"
            >
              <Share2 className="h-4 w-4" />
            </button>
          )}

          <button
            className="p-2 hover:bg-accent rounded-md transition-colors"
            title="More options"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Page Content */}
      <div className="flex-1 overflow-hidden bg-muted/10">
        {page.pageType === 'DRIVE_FILE' && page.driveFileId ? (
          <iframe
            src={getEmbedUrl(page) || ''}
            className="w-full h-full border-0"
            title={page.title}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : page.pageType === 'CANVAS' ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <p className="text-lg mb-2">Canvas Drawing</p>
              <p className="text-sm mb-4">Click to open the drawing editor</p>
              <button className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors">
                Open Canvas Editor
              </button>
            </div>
          </div>
        ) : page.pageType === 'EMBED' ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <p className="text-lg mb-2">Embedded Content</p>
              <p className="text-sm">This content is embedded from an external source</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <p className="text-lg mb-2">Content Preview</p>
              <p className="text-sm">Preview not available for this page type</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

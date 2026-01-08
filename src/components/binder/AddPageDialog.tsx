import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, FileText, Sheet, Presentation, PenTool, Upload, Link, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { base44 } from '@/lib/base44-sdk'
import { cn } from '@/lib/utils'

type PageTypeOption = 'doc' | 'sheet' | 'slides' | 'canvas' | 'upload' | 'link'

interface AddPageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: 'page' | 'folder'
  binderId: string
  sectionId: string
  folderId?: string
}

export default function AddPageDialog({
  open,
  onOpenChange,
  type,
  binderId,
  sectionId,
  folderId,
}: AddPageDialogProps) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [pageType, setPageType] = useState<PageTypeOption>('doc')
  const [linkUrl, setLinkUrl] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const pageTypes: { type: PageTypeOption; label: string; icon: React.ReactNode; description: string }[] = [
    { type: 'doc', label: 'Document', icon: <FileText className="h-5 w-5 icon-docs" />, description: 'Google Docs' },
    { type: 'sheet', label: 'Spreadsheet', icon: <Sheet className="h-5 w-5 icon-sheets" />, description: 'Google Sheets' },
    { type: 'slides', label: 'Presentation', icon: <Presentation className="h-5 w-5 icon-slides" />, description: 'Google Slides' },
    { type: 'canvas', label: 'Drawing', icon: <PenTool className="h-5 w-5 icon-canvas" />, description: 'Canvas drawing' },
    { type: 'upload', label: 'Upload', icon: <Upload className="h-5 w-5 text-muted-foreground" />, description: 'Upload a file' },
    { type: 'link', label: 'Link', icon: <Link className="h-5 w-5 text-muted-foreground" />, description: 'Embed a link' },
  ]

  const createPageMutation = useMutation({
    mutationFn: async () => {
      if (type === 'folder') {
        await base44.functions.invoke('createFolder', {
          binderId,
          sectionId,
          parentFolderId: folderId,
          title,
        })
      } else {
        // Create page based on type
        const pageData: Record<string, unknown> = {
          binderId,
          sectionId,
          folderId,
          title,
          pageType: pageType === 'canvas' ? 'CANVAS' : 'DRIVE_FILE',
          originType: 'STUDENT_ADDED',
          distributionStatus: 'private',
          origin: 'APP',
          managedByApp: true,
        }

        if (pageType === 'link') {
          pageData.pageType = 'EMBED'
          // In real implementation, handle link embedding
        }

        await base44.entities.Page.create(pageData)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pages'] })
      queryClient.invalidateQueries({ queryKey: ['folders'] })
      toast.success(type === 'folder' ? 'Folder created' : 'Page created')
      onOpenChange(false)
    },
    onError: () => {
      toast.error(type === 'folder' ? 'Failed to create folder' : 'Failed to create page')
    },
  })

  const handleCreate = async () => {
    if (!title.trim()) {
      toast.error('Please enter a title')
      return
    }
    if (pageType === 'link' && !linkUrl.trim()) {
      toast.error('Please enter a URL')
      return
    }
    setIsCreating(true)
    try {
      await createPageMutation.mutateAsync()
    } finally {
      setIsCreating(false)
    }
  }

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setTitle('')
      setPageType('doc')
      setLinkUrl('')
      setIsCreating(false)
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
      />

      {/* Dialog */}
      <div className="relative bg-background rounded-lg shadow-elevation-4 w-full max-w-md mx-4">
        {/* Header */}
        <header className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">
            {type === 'folder' ? 'Create New Folder' : 'Add New Page'}
          </h2>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1 hover:bg-accent rounded transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Title Input */}
          <div>
            <label className="block text-sm font-medium mb-1">
              {type === 'folder' ? 'Folder Name' : 'Page Title'}
            </label>
            <input
              type="text"
              placeholder={type === 'folder' ? 'Enter folder name...' : 'Enter page title...'}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              autoFocus
            />
          </div>

          {/* Page Type Selection (only for pages) */}
          {type === 'page' && (
            <div>
              <label className="block text-sm font-medium mb-2">Page Type</label>
              <div className="grid grid-cols-3 gap-2">
                {pageTypes.map(({ type: pt, label, icon, description }) => (
                  <button
                    key={pt}
                    onClick={() => setPageType(pt)}
                    className={cn(
                      "flex flex-col items-center gap-1 p-3 rounded-md border transition-colors",
                      pageType === pt
                        ? "border-primary bg-primary/5"
                        : "hover:bg-accent/50"
                    )}
                  >
                    {icon}
                    <span className="text-xs font-medium">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Link URL Input (only for link type) */}
          {type === 'page' && pageType === 'link' && (
            <div>
              <label className="block text-sm font-medium mb-1">URL</label>
              <input
                type="url"
                placeholder="https://..."
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 p-4 border-t">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm hover:bg-accent rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!title.trim() || isCreating}
            className="px-4 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
            {type === 'folder' ? 'Create Folder' : 'Create Page'}
          </button>
        </footer>
      </div>
    </div>
  )
}

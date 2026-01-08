import { useState } from 'react'
import { Search, Plus, FolderPlus, File, FileText, Sheet, Presentation, Image, PenTool, MoreVertical, Trash2, Share2, Folder, ChevronRight, ChevronDown } from 'lucide-react'
import type { Page, Folder as FolderType } from '@/types'
import { cn } from '@/lib/utils'
import AddPageDialog from './AddPageDialog'

interface PageListProps {
  pages: Page[]
  folders: FolderType[]
  selectedPageId: string | null
  onPageSelect: (pageId: string) => void
  searchQuery: string
  onSearchChange: (query: string) => void
  isTeacher: boolean
  sectionId: string
  binderId: string
}

// Get icon based on page type and mime type
function getPageIcon(page: Page) {
  if (page.pageType === 'CANVAS') {
    return <PenTool className="h-4 w-4 icon-canvas" />
  }

  if (page.pageType === 'DRIVE_FILE' && page.driveMimeType) {
    switch (page.driveMimeType) {
      case 'application/vnd.google-apps.document':
        return <FileText className="h-4 w-4 icon-docs" />
      case 'application/vnd.google-apps.spreadsheet':
        return <Sheet className="h-4 w-4 icon-sheets" />
      case 'application/vnd.google-apps.presentation':
        return <Presentation className="h-4 w-4 icon-slides" />
      case 'application/pdf':
        return <File className="h-4 w-4 icon-pdf" />
      case 'image/png':
      case 'image/jpeg':
      case 'image/gif':
        return <Image className="h-4 w-4 icon-image" />
      default:
        return <File className="h-4 w-4 text-muted-foreground" />
    }
  }

  return <File className="h-4 w-4 text-muted-foreground" />
}

// Get distribution badge
function getDistributionBadge(page: Page) {
  if (page.distributionStatus === 'viewOnlyDistributed') {
    return (
      <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded" title="View-only distributed">
        View
      </span>
    )
  }
  if (page.distributionStatus === 'copyDistributed') {
    return (
      <span className="px-1.5 py-0.5 text-xs bg-green-100 text-green-700 rounded" title="Copy distributed">
        Copy
      </span>
    )
  }
  return null
}

export default function PageList({
  pages,
  folders,
  selectedPageId,
  onPageSelect,
  searchQuery,
  onSearchChange,
  isTeacher,
  sectionId,
  binderId,
}: PageListProps) {
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [addDialogType, setAddDialogType] = useState<'page' | 'folder'>('page')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [activeMenu, setActiveMenu] = useState<string | null>(null)

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(folderId)) {
        next.delete(folderId)
      } else {
        next.add(folderId)
      }
      return next
    })
  }

  const handleAddPage = () => {
    setAddDialogType('page')
    setShowAddDialog(true)
  }

  const handleAddFolder = () => {
    setAddDialogType('folder')
    setShowAddDialog(true)
  }

  // Group pages by folder
  const rootPages = pages.filter(p => !p.folderId)
  const pagesByFolder = pages.reduce((acc, page) => {
    if (page.folderId) {
      if (!acc[page.folderId]) acc[page.folderId] = []
      acc[page.folderId].push(page)
    }
    return acc
  }, {} as Record<string, Page[]>)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Search Bar */}
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search pages..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>
      </div>

      {/* Actions Bar */}
      <div className="flex items-center gap-1 p-2 border-b">
        <button
          onClick={handleAddPage}
          className="flex items-center gap-1 px-3 py-1.5 text-sm hover:bg-accent rounded-md transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Page
        </button>
        <button
          onClick={handleAddFolder}
          className="flex items-center gap-1 px-3 py-1.5 text-sm hover:bg-accent rounded-md transition-colors"
        >
          <FolderPlus className="h-4 w-4" />
          New Folder
        </button>
      </div>

      {/* Page/Folder List */}
      <div className="flex-1 overflow-y-auto">
        {/* Folders */}
        {folders.filter(f => !f.parentFolderId).map((folder) => (
          <div key={folder.id}>
            <button
              onClick={() => toggleFolder(folder.id)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors text-left"
            >
              {expandedFolders.has(folder.id) ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <Folder className="h-4 w-4 text-yellow-500" />
              <span className="flex-1 truncate text-sm font-medium">{folder.title}</span>
            </button>

            {/* Folder Contents */}
            {expandedFolders.has(folder.id) && (
              <div className="pl-6">
                {(pagesByFolder[folder.id] || []).map((page) => (
                  <PageItem
                    key={page.id}
                    page={page}
                    isSelected={selectedPageId === page.id}
                    onSelect={() => onPageSelect(page.id)}
                    isTeacher={isTeacher}
                    activeMenu={activeMenu}
                    setActiveMenu={setActiveMenu}
                  />
                ))}
                {(!pagesByFolder[folder.id] || pagesByFolder[folder.id].length === 0) && (
                  <div className="px-3 py-2 text-sm text-muted-foreground italic">
                    Empty folder
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Root Pages */}
        {rootPages.map((page) => (
          <PageItem
            key={page.id}
            page={page}
            isSelected={selectedPageId === page.id}
            onSelect={() => onPageSelect(page.id)}
            isTeacher={isTeacher}
            activeMenu={activeMenu}
            setActiveMenu={setActiveMenu}
          />
        ))}

        {/* Empty State */}
        {pages.length === 0 && folders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <File className="h-12 w-12 mb-4 opacity-20" />
            <p className="text-sm">No pages yet</p>
            <button
              onClick={handleAddPage}
              className="mt-4 px-4 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
            >
              Add your first page
            </button>
          </div>
        )}
      </div>

      {/* Add Page/Folder Dialog */}
      <AddPageDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        type={addDialogType}
        binderId={binderId}
        sectionId={sectionId}
      />
    </div>
  )
}

// Individual Page Item Component
interface PageItemProps {
  page: Page
  isSelected: boolean
  onSelect: () => void
  isTeacher: boolean
  activeMenu: string | null
  setActiveMenu: (id: string | null) => void
}

function PageItem({ page, isSelected, onSelect, isTeacher, activeMenu, setActiveMenu }: PageItemProps) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors relative",
        isSelected ? "bg-accent" : "hover:bg-accent/50"
      )}
      onClick={onSelect}
    >
      {getPageIcon(page)}
      <span className="flex-1 truncate text-sm">{page.title}</span>
      {getDistributionBadge(page)}

      {/* Page Menu */}
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation()
            setActiveMenu(activeMenu === page.id ? null : page.id)
          }}
          className={cn(
            "p-1 rounded hover:bg-background transition-opacity",
            activeMenu === page.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        >
          <MoreVertical className="h-4 w-4" />
        </button>

        {activeMenu === page.id && (
          <div className="absolute top-full right-0 mt-1 w-40 bg-popover border rounded-md shadow-elevation-2 z-50">
            <div className="p-1">
              {isTeacher && page.distributionStatus === 'private' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    // Handle distribute
                    setActiveMenu(null)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent"
                >
                  <Share2 className="h-4 w-4" />
                  Distribute
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  // Handle delete
                  setActiveMenu(null)
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

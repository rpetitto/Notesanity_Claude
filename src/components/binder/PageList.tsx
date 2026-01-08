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
    return <PenTool className="h-5 w-5 icon-canvas" />
  }

  if (page.pageType === 'DRIVE_FILE' && page.driveMimeType) {
    switch (page.driveMimeType) {
      case 'application/vnd.google-apps.document':
        return <FileText className="h-5 w-5 icon-docs" />
      case 'application/vnd.google-apps.spreadsheet':
        return <Sheet className="h-5 w-5 icon-sheets" />
      case 'application/vnd.google-apps.presentation':
        return <Presentation className="h-5 w-5 icon-slides" />
      case 'application/pdf':
        return <File className="h-5 w-5 icon-pdf" />
      case 'image/png':
      case 'image/jpeg':
      case 'image/gif':
        return <Image className="h-5 w-5 icon-image" />
      default:
        return <File className="h-5 w-5 text-on-surface-variant" />
    }
  }

  return <File className="h-5 w-5 text-on-surface-variant" />
}

// Get distribution badge - Material v3 style
function getDistributionBadge(page: Page) {
  if (page.distributionStatus === 'viewOnlyDistributed') {
    return (
      <span className="px-2 py-0.5 text-label-small bg-primary-container text-on-primary-container rounded-small" title="View-only distributed">
        View
      </span>
    )
  }
  if (page.distributionStatus === 'copyDistributed') {
    return (
      <span className="px-2 py-0.5 text-label-small bg-tertiary-container text-on-tertiary-container rounded-small" title="Copy distributed">
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
    <div className="flex-1 flex flex-col overflow-hidden bg-surface">
      {/* Search Bar - Material v3 style */}
      <div className="p-3 border-b border-outline-variant">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-on-surface-variant" />
          <input
            type="text"
            placeholder="Search pages..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-12 pr-4 py-3 text-body-large bg-surface-container-highest rounded-full
                       focus:outline-none focus:ring-2 focus:ring-primary border-0
                       placeholder:text-on-surface-variant"
          />
        </div>
      </div>

      {/* Actions Bar - Material v3 buttons */}
      <div className="flex items-center gap-2 p-3 border-b border-outline-variant">
        <button
          onClick={handleAddPage}
          className="btn-filled-tonal"
        >
          <Plus className="h-5 w-5" />
          Add Page
        </button>
        <button
          onClick={handleAddFolder}
          className="btn-outlined"
        >
          <FolderPlus className="h-5 w-5" />
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
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-variant transition-colors text-left state-layer"
            >
              {expandedFolders.has(folder.id) ? (
                <ChevronDown className="h-5 w-5 text-on-surface-variant" />
              ) : (
                <ChevronRight className="h-5 w-5 text-on-surface-variant" />
              )}
              <Folder className="h-5 w-5 text-tertiary" />
              <span className="flex-1 truncate text-body-large font-medium text-on-surface">{folder.title}</span>
            </button>

            {/* Folder Contents */}
            {expandedFolders.has(folder.id) && (
              <div className="pl-8">
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
                  <div className="px-4 py-3 text-body-medium text-on-surface-variant italic">
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

        {/* Empty State - Material v3 style */}
        {pages.length === 0 && folders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
            <div className="w-20 h-20 rounded-full bg-surface-container-highest flex items-center justify-center mb-6">
              <File className="h-10 w-10 opacity-40" />
            </div>
            <p className="text-title-medium mb-2">No pages yet</p>
            <p className="text-body-medium text-on-surface-variant mb-6">Add your first page to get started</p>
            <button
              onClick={handleAddPage}
              className="btn-filled"
            >
              <Plus className="h-5 w-5" />
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

// Individual Page Item Component - Material v3 list item
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
        "group flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors relative state-layer",
        isSelected
          ? "bg-secondary-container text-on-secondary-container"
          : "hover:bg-surface-variant text-on-surface"
      )}
      onClick={onSelect}
    >
      {getPageIcon(page)}
      <span className="flex-1 truncate text-body-large">{page.title}</span>
      {getDistributionBadge(page)}

      {/* Page Menu */}
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation()
            setActiveMenu(activeMenu === page.id ? null : page.id)
          }}
          className={cn(
            "p-2 rounded-full hover:bg-surface-container-high transition-opacity",
            activeMenu === page.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        >
          <MoreVertical className="h-5 w-5 text-on-surface-variant" />
        </button>

        {activeMenu === page.id && (
          <div className="absolute top-full right-0 mt-1 w-48 bg-surface-container rounded-medium shadow-elevation-2 z-50 border border-outline-variant overflow-hidden">
            <div className="py-1">
              {isTeacher && page.distributionStatus === 'private' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    // Handle distribute
                    setActiveMenu(null)
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-body-medium text-on-surface hover:bg-surface-variant transition-colors"
                >
                  <Share2 className="h-5 w-5 text-on-surface-variant" />
                  Distribute
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  // Handle delete
                  setActiveMenu(null)
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-body-medium text-error hover:bg-error-container transition-colors"
              >
                <Trash2 className="h-5 w-5" />
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

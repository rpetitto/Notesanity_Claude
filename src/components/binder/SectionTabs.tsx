import { useState } from 'react'
import { Plus, MoreVertical, Eye, EyeOff, Trash2, Users } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { base44 } from '@/lib/base44-sdk'
import type { Section } from '@/types'
import { cn } from '@/lib/utils'
import AddSectionDialog from './AddSectionDialog'
import DeleteSectionDialog from './DeleteSectionDialog'

// Predefined colors for custom sections
const SECTION_COLORS = [
  '#4285f4', // Blue
  '#ea4335', // Red
  '#fbbc04', // Yellow
  '#34a853', // Green
  '#ff6d01', // Orange
  '#46bdc6', // Teal
  '#7baaf7', // Light Blue
  '#f07b72', // Salmon
  '#a142f4', // Purple
  '#24c1e0', // Cyan
]

interface SectionTabsProps {
  sections: Section[]
  selectedSectionId: string | null
  onSectionSelect: (sectionId: string) => void
  isTeacher: boolean
  binderId: string
  onShowRoster: () => void
  showingRoster: boolean
}

export default function SectionTabs({
  sections,
  selectedSectionId,
  onSectionSelect,
  isTeacher,
  binderId,
  onShowRoster,
  showingRoster,
}: SectionTabsProps) {
  const queryClient = useQueryClient()
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [sectionToDelete, setSectionToDelete] = useState<Section | null>(null)
  const [activeMenu, setActiveMenu] = useState<string | null>(null)

  const publishMutation = useMutation({
    mutationFn: async (sectionId: string) => {
      await base44.functions.invoke('publishSection', { sectionId })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sections'] })
      toast.success('Section published')
    },
    onError: () => {
      toast.error('Failed to publish section')
    },
  })

  const unpublishMutation = useMutation({
    mutationFn: async (sectionId: string) => {
      await base44.functions.invoke('unpublishSection', { sectionId })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sections'] })
      toast.success('Section unpublished')
    },
    onError: () => {
      toast.error('Failed to unpublish section')
    },
  })

  const getTabColor = (section: Section, index: number) => {
    if (section.color) return section.color
    if (section.isSystem) return '#5f6368' // Gray for system tabs
    return SECTION_COLORS[index % SECTION_COLORS.length]
  }

  return (
    <div className="border-b">
      {/* Tabs Container */}
      <div className="flex items-center overflow-x-auto px-2 py-1 gap-1">
        {sections.map((section, index) => (
          <div key={section.id} className="relative flex-shrink-0">
            <button
              onClick={() => onSectionSelect(section.id)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-t-md text-sm font-medium transition-all",
                selectedSectionId === section.id
                  ? "bg-background border border-b-0 -mb-px"
                  : "hover:bg-accent/50"
              )}
              style={{
                borderTopColor: selectedSectionId === section.id ? getTabColor(section, index) : 'transparent',
                borderTopWidth: selectedSectionId === section.id ? '3px' : '0',
              }}
            >
              <span>{section.title}</span>
              {!section.published && isTeacher && (
                <EyeOff className="h-3 w-3 text-muted-foreground" title="Not published to students" />
              )}
            </button>

            {/* Section Menu for Teachers */}
            {isTeacher && !section.isSystem && (
              <div className="absolute top-1 right-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setActiveMenu(activeMenu === section.id ? null : section.id)
                  }}
                  className="p-1 hover:bg-accent rounded opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreVertical className="h-3 w-3" />
                </button>

                {activeMenu === section.id && (
                  <div className="absolute top-full right-0 mt-1 w-40 bg-popover border rounded-md shadow-elevation-2 z-50">
                    <div className="p-1">
                      {section.published ? (
                        <button
                          onClick={() => {
                            unpublishMutation.mutate(section.id)
                            setActiveMenu(null)
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent"
                        >
                          <EyeOff className="h-4 w-4" />
                          Unpublish
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            publishMutation.mutate(section.id)
                            setActiveMenu(null)
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent"
                        >
                          <Eye className="h-4 w-4" />
                          Publish
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setSectionToDelete(section)
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
            )}
          </div>
        ))}

        {/* Add Section Button */}
        {isTeacher && (
          <button
            onClick={() => setShowAddDialog(true)}
            className="flex-shrink-0 p-2 hover:bg-accent rounded-md transition-colors"
            title="Add section"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Roster Button */}
        {isTeacher && (
          <button
            onClick={onShowRoster}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
              showingRoster ? "bg-primary text-white" : "hover:bg-accent"
            )}
          >
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Roster</span>
          </button>
        )}
      </div>

      {/* Add Section Dialog */}
      <AddSectionDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        binderId={binderId}
        colors={SECTION_COLORS}
      />

      {/* Delete Section Dialog */}
      <DeleteSectionDialog
        section={sectionToDelete}
        onClose={() => setSectionToDelete(null)}
      />
    </div>
  )
}

import { useState } from 'react'
import { Plus, MoreVertical, Eye, EyeOff, Trash2, Users } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { base44 } from '@/lib/base44-sdk'
import type { Section } from '@/types'
import { cn } from '@/lib/utils'
import AddSectionDialog from './AddSectionDialog'
import DeleteSectionDialog from './DeleteSectionDialog'

// Material v3 inspired colors for custom sections
const SECTION_COLORS = [
  '#6750A4', // Primary
  '#B3261E', // Error (red)
  '#7D5260', // Tertiary
  '#386A20', // Green
  '#984061', // Pink
  '#006A6A', // Teal
  '#4355B9', // Indigo
  '#865200', // Orange/Amber
  '#984715', // Deep Orange
  '#006B5E', // Green variant
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
    if (section.isSystem) return '#79747E' // Outline color for system tabs
    return SECTION_COLORS[index % SECTION_COLORS.length]
  }

  return (
    <div className="border-b border-outline-variant bg-surface-container-low">
      {/* Tabs Container - Material v3 navigation rail style */}
      <div className="flex items-center overflow-x-auto px-2 py-2 gap-1">
        {sections.map((section, index) => (
          <div key={section.id} className="relative flex-shrink-0 group">
            <button
              onClick={() => onSectionSelect(section.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-full text-label-large transition-all state-layer",
                selectedSectionId === section.id
                  ? "bg-secondary-container text-on-secondary-container"
                  : "hover:bg-surface-variant text-on-surface-variant"
              )}
              style={{
                backgroundColor: selectedSectionId === section.id
                  ? `color-mix(in srgb, ${getTabColor(section, index)} 15%, transparent)`
                  : undefined,
                color: selectedSectionId === section.id
                  ? getTabColor(section, index)
                  : undefined,
              }}
            >
              {/* Color indicator */}
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: getTabColor(section, index) }}
              />
              <span>{section.title}</span>
              {!section.published && isTeacher && (
                <EyeOff className="h-4 w-4 opacity-60" title="Not published to students" />
              )}
            </button>

            {/* Section Menu for Teachers */}
            {isTeacher && !section.isSystem && (
              <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setActiveMenu(activeMenu === section.id ? null : section.id)
                  }}
                  className="p-1.5 rounded-full hover:bg-surface-variant transition-colors"
                >
                  <MoreVertical className="h-4 w-4 text-on-surface-variant" />
                </button>

                {activeMenu === section.id && (
                  <div className="absolute top-full right-0 mt-1 w-44 bg-surface-container rounded-medium shadow-elevation-2 z-50 border border-outline-variant overflow-hidden">
                    <div className="py-1">
                      {section.published ? (
                        <button
                          onClick={() => {
                            unpublishMutation.mutate(section.id)
                            setActiveMenu(null)
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-body-medium text-on-surface hover:bg-surface-variant transition-colors"
                        >
                          <EyeOff className="h-5 w-5 text-on-surface-variant" />
                          Unpublish
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            publishMutation.mutate(section.id)
                            setActiveMenu(null)
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-body-medium text-on-surface hover:bg-surface-variant transition-colors"
                        >
                          <Eye className="h-5 w-5 text-on-surface-variant" />
                          Publish
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setSectionToDelete(section)
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
            )}
          </div>
        ))}

        {/* Add Section Button - Material v3 icon button */}
        {isTeacher && (
          <button
            onClick={() => setShowAddDialog(true)}
            className="btn-icon flex-shrink-0"
            title="Add section"
          >
            <Plus className="h-5 w-5" />
          </button>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Roster Button - Material v3 filled tonal button */}
        {isTeacher && (
          <button
            onClick={onShowRoster}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-full text-label-large font-medium transition-all state-layer",
              showingRoster
                ? "bg-primary text-on-primary"
                : "bg-secondary-container text-on-secondary-container hover:shadow-elevation-1"
            )}
          >
            <Users className="h-5 w-5" />
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

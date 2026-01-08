import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { base44 } from '@/lib/base44-sdk'
import type { Section } from '@/types'

interface DeleteSectionDialogProps {
  section: Section | null
  onClose: () => void
}

export default function DeleteSectionDialog({ section, onClose }: DeleteSectionDialogProps) {
  const queryClient = useQueryClient()
  const [isDeleting, setIsDeleting] = useState(false)

  const deleteSectionMutation = useMutation({
    mutationFn: async () => {
      if (!section) return
      await base44.functions.invoke('deleteSectionAndDriveFolder', {
        sectionId: section.id,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sections'] })
      queryClient.invalidateQueries({ queryKey: ['pages'] })
      toast.success('Section deleted')
      onClose()
    },
    onError: () => {
      toast.error('Failed to delete section')
    },
  })

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      await deleteSectionMutation.mutateAsync()
    } finally {
      setIsDeleting(false)
    }
  }

  if (!section) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative bg-background rounded-lg shadow-elevation-4 w-full max-w-sm mx-4">
        {/* Header */}
        <header className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold text-destructive">Delete Section</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-accent rounded transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Content */}
        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-destructive/10 rounded-full flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="font-medium mb-1">
                Delete "{section.title}"?
              </p>
              <p className="text-sm text-muted-foreground">
                This will permanently delete this section and all pages within it.
                This action cannot be undone.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 p-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm hover:bg-accent rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="px-4 py-2 text-sm bg-destructive text-white rounded-md hover:bg-destructive/90 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete Section
          </button>
        </footer>
      </div>
    </div>
  )
}

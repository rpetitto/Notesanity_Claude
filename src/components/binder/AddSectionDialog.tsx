import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { base44 } from '@/lib/base44-sdk'
import { cn } from '@/lib/utils'

interface AddSectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  binderId: string
  colors: string[]
}

export default function AddSectionDialog({
  open,
  onOpenChange,
  binderId,
  colors,
}: AddSectionDialogProps) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [selectedColor, setSelectedColor] = useState(colors[0])
  const [isCreating, setIsCreating] = useState(false)

  const createSectionMutation = useMutation({
    mutationFn: async () => {
      await base44.functions.invoke('createSectionAndDriveFolder', {
        binderId,
        title,
        color: selectedColor,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sections'] })
      toast.success('Section created')
      onOpenChange(false)
    },
    onError: () => {
      toast.error('Failed to create section')
    },
  })

  const handleCreate = async () => {
    if (!title.trim()) {
      toast.error('Please enter a title')
      return
    }
    setIsCreating(true)
    try {
      await createSectionMutation.mutateAsync()
    } finally {
      setIsCreating(false)
    }
  }

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setTitle('')
      setSelectedColor(colors[0])
      setIsCreating(false)
    }
  }, [open, colors])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
      />

      {/* Dialog */}
      <div className="relative bg-background rounded-lg shadow-elevation-4 w-full max-w-sm mx-4">
        {/* Header */}
        <header className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Add New Section</h2>
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
            <label className="block text-sm font-medium mb-1">Section Name</label>
            <input
              type="text"
              placeholder="Enter section name..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              autoFocus
            />
          </div>

          {/* Color Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">Tab Color</label>
            <div className="flex flex-wrap gap-2">
              {colors.map((color) => (
                <button
                  key={color}
                  onClick={() => setSelectedColor(color)}
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center transition-transform",
                    selectedColor === color && "ring-2 ring-offset-2 ring-primary scale-110"
                  )}
                  style={{ backgroundColor: color }}
                >
                  {selectedColor === color && (
                    <Check className="h-4 w-4 text-white" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div>
            <label className="block text-sm font-medium mb-2">Preview</label>
            <div className="border rounded-md p-3 bg-muted/30">
              <div
                className="inline-block px-3 py-2 rounded-t-md text-sm font-medium bg-background border border-b-0"
                style={{ borderTopColor: selectedColor, borderTopWidth: '3px' }}
              >
                {title || 'New Section'}
              </div>
            </div>
          </div>
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
            Create Section
          </button>
        </footer>
      </div>
    </div>
  )
}

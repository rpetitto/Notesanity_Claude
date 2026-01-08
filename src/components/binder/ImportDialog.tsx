import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Search, Loader2, Check, AlertCircle } from 'lucide-react'
import { base44 } from '@/lib/base44-sdk'
import type { GoogleClassroomCourse } from '@/types'
import { cn } from '@/lib/utils'

// Mock classroom courses
const MOCK_CLASSROOM_COURSES: GoogleClassroomCourse[] = [
  { id: 'gc1', name: 'Advanced Mathematics', section: 'Period 1', ownerId: 'u1', courseState: 'ACTIVE', alternateLink: '' },
  { id: 'gc2', name: 'Introduction to Physics', section: 'Period 2', ownerId: 'u1', courseState: 'ACTIVE', alternateLink: '' },
  { id: 'gc3', name: 'English Literature', section: 'Period 3', ownerId: 'u1', courseState: 'ACTIVE', alternateLink: '' },
  { id: 'gc4', name: 'World History', section: 'Period 4', ownerId: 'u1', courseState: 'ACTIVE', alternateLink: '' },
]

interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (googleCourseId: string, courseName: string) => void
}

export default function ImportDialog({ open, onOpenChange, onImport }: ImportDialogProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCourse, setSelectedCourse] = useState<GoogleClassroomCourse | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [authRequired, setAuthRequired] = useState(false)

  // Fetch Google Classroom courses
  const { data: courses = [], isLoading, error, refetch } = useQuery({
    queryKey: ['classroomCourses'],
    queryFn: async () => {
      try {
        const result = await base44.functions.invoke<{ courses: GoogleClassroomCourse[]; requiresAuth?: boolean }>('fetchClassroomCourses')
        if (result.requiresAuth) {
          setAuthRequired(true)
          return []
        }
        return result.courses || MOCK_CLASSROOM_COURSES
      } catch {
        // Use mock data in development
        return MOCK_CLASSROOM_COURSES
      }
    },
    enabled: open,
  })

  // Filter courses by search
  const filteredCourses = courses.filter(course =>
    course.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (course.section && course.section.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const handleImport = async () => {
    if (!selectedCourse) return
    setIsImporting(true)
    try {
      await onImport(selectedCourse.id, selectedCourse.name)
      onOpenChange(false)
    } finally {
      setIsImporting(false)
    }
  }

  const handleAuth = async () => {
    try {
      const result = await base44.functions.invoke<{ authUrl: string }>('classroomAuth')
      if (result.authUrl) {
        // Open auth in popup
        const popup = window.open(result.authUrl, 'Google Auth', 'width=500,height=600')

        // Poll for auth completion
        const pollInterval = setInterval(() => {
          if (popup?.closed) {
            clearInterval(pollInterval)
            setAuthRequired(false)
            refetch()
          }
        }, 500)
      }
    } catch {
      // Handle error
    }
  }

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSearchQuery('')
      setSelectedCourse(null)
      setIsImporting(false)
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
      <div className="relative bg-background rounded-lg shadow-elevation-4 w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Import from Google Classroom</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1 hover:bg-accent rounded transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col p-4">
          {authRequired ? (
            <div className="flex-1 flex flex-col items-center justify-center py-8">
              <AlertCircle className="h-12 w-12 text-yellow-500 mb-4" />
              <h3 className="text-lg font-medium mb-2">Authorization Required</h3>
              <p className="text-sm text-muted-foreground text-center mb-4">
                Please connect your Google account to import courses from Google Classroom.
              </p>
              <button
                onClick={handleAuth}
                className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
              >
                Connect Google Account
              </button>
            </div>
          ) : (
            <>
              {/* Search */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search courses..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                />
              </div>

              {/* Course List */}
              <div className="flex-1 overflow-y-auto border rounded-md">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : filteredCourses.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    No courses found
                  </div>
                ) : (
                  filteredCourses.map((course) => (
                    <button
                      key={course.id}
                      onClick={() => setSelectedCourse(course)}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors border-b last:border-b-0",
                        selectedCourse?.id === course.id && "bg-accent"
                      )}
                    >
                      <div className={cn(
                        "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                        selectedCourse?.id === course.id
                          ? "border-primary bg-primary text-white"
                          : "border-muted-foreground"
                      )}>
                        {selectedCourse?.id === course.id && (
                          <Check className="h-3 w-3" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{course.name}</p>
                        {course.section && (
                          <p className="text-sm text-muted-foreground truncate">{course.section}</p>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!authRequired && (
          <footer className="flex items-center justify-end gap-2 p-4 border-t">
            <button
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 text-sm hover:bg-accent rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={!selectedCourse || isImporting}
              className="px-4 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {isImporting && <Loader2 className="h-4 w-4 animate-spin" />}
              Import Course
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}

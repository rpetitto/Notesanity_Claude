import { RefreshCw, Import, Trash2, ChevronDown, Check, X } from 'lucide-react'
import type { Course, SyncStatus } from '@/types'
import { cn } from '@/lib/utils'

interface TopBarProps {
  courses: Course[]
  selectedCourseId: string | null
  onCourseChange: (courseId: string) => void
  syncStatus: SyncStatus
  onSync: () => void
  onImport: () => void
  isTeacher: boolean
  viewingStudentId: string | null
  onExitStudentView: () => void
}

export default function TopBar({
  courses,
  selectedCourseId,
  onCourseChange,
  syncStatus,
  onSync,
  onImport,
  isTeacher,
  viewingStudentId,
  onExitStudentView,
}: TopBarProps) {
  const selectedCourse = courses.find(c => c.id === selectedCourseId)

  const formatSyncTime = (timestamp?: string) => {
    if (!timestamp) return 'Never synced'
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    return date.toLocaleDateString()
  }

  return (
    <header className="h-14 border-b flex items-center px-4 gap-4 bg-card shadow-elevation-1">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
          <span className="text-white font-bold text-sm">NB</span>
        </div>
        <span className="font-semibold text-lg hidden sm:inline">Notebook Binder</span>
      </div>

      {/* Course Selector */}
      <div className="relative group">
        <button className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-accent transition-colors">
          <span className="font-medium">
            {selectedCourse?.name || 'Select Course'}
          </span>
          {selectedCourse?.section && (
            <span className="text-sm text-muted-foreground">
              ({selectedCourse.section})
            </span>
          )}
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>

        {/* Dropdown */}
        <div className="absolute top-full left-0 mt-1 w-64 bg-popover border rounded-md shadow-elevation-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
          <div className="p-1">
            {courses.map((course) => (
              <button
                key={course.id}
                onClick={() => onCourseChange(course.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-accent transition-colors",
                  course.id === selectedCourseId && "bg-accent"
                )}
              >
                <Check className={cn(
                  "h-4 w-4",
                  course.id === selectedCourseId ? "opacity-100" : "opacity-0"
                )} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{course.name}</p>
                  {course.section && (
                    <p className="text-sm text-muted-foreground truncate">{course.section}</p>
                  )}
                </div>
              </button>
            ))}
            {courses.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">No courses available</p>
            )}
          </div>
        </div>
      </div>

      {/* Student View Banner */}
      {viewingStudentId && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-100 text-yellow-800 rounded-md">
          <span className="text-sm font-medium">Viewing as student</span>
          <button
            onClick={onExitStudentView}
            className="p-0.5 hover:bg-yellow-200 rounded transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Sync Status */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {syncStatus.isSyncing ? (
          <>
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>Syncing...</span>
          </>
        ) : syncStatus.error ? (
          <>
            <span className="text-destructive">Sync error</span>
          </>
        ) : (
          <span>Last sync: {formatSyncTime(syncStatus.lastSyncAt)}</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        {isTeacher && (
          <>
            <button
              onClick={onSync}
              disabled={syncStatus.isSyncing}
              className="p-2 hover:bg-accent rounded-md transition-colors disabled:opacity-50"
              title="Sync with Google Drive"
            >
              <RefreshCw className={cn("h-5 w-5", syncStatus.isSyncing && "animate-spin")} />
            </button>
            <button
              onClick={onImport}
              className="p-2 hover:bg-accent rounded-md transition-colors"
              title="Import from Google Classroom"
            >
              <Import className="h-5 w-5" />
            </button>
          </>
        )}
      </div>
    </header>
  )
}

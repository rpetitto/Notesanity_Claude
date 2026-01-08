import { RefreshCw, Import, ChevronDown, Check, X } from 'lucide-react'
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
    <header className="h-16 border-b border-outline-variant flex items-center px-4 gap-4 bg-surface-container-low">
      {/* Logo - Material v3 branded container */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-primary rounded-large flex items-center justify-center shadow-elevation-1">
          <span className="text-on-primary font-medium text-title-medium">NS</span>
        </div>
        <span className="font-medium text-title-large text-on-surface hidden sm:inline">Notesanity</span>
      </div>

      {/* Course Selector - Material v3 style */}
      <div className="relative group">
        <button className="flex items-center gap-2 px-4 py-2 rounded-full hover:bg-surface-variant transition-colors state-layer">
          <span className="font-medium text-label-large text-on-surface">
            {selectedCourse?.name || 'Select Course'}
          </span>
          {selectedCourse?.section && (
            <span className="text-body-medium text-on-surface-variant">
              ({selectedCourse.section})
            </span>
          )}
          <ChevronDown className="h-5 w-5 text-on-surface-variant" />
        </button>

        {/* Dropdown - Material v3 menu surface */}
        <div className="absolute top-full left-0 mt-1 w-72 bg-surface-container rounded-medium shadow-elevation-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 border border-outline-variant">
          <div className="p-1">
            {courses.map((course) => (
              <button
                key={course.id}
                onClick={() => onCourseChange(course.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-small text-left transition-colors state-layer",
                  course.id === selectedCourseId
                    ? "bg-secondary-container text-on-secondary-container"
                    : "hover:bg-surface-variant text-on-surface"
                )}
              >
                <Check className={cn(
                  "h-5 w-5 text-primary",
                  course.id === selectedCourseId ? "opacity-100" : "opacity-0"
                )} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-body-large truncate">{course.name}</p>
                  {course.section && (
                    <p className="text-body-small text-on-surface-variant truncate">{course.section}</p>
                  )}
                </div>
              </button>
            ))}
            {courses.length === 0 && (
              <p className="px-4 py-3 text-body-medium text-on-surface-variant">No courses available</p>
            )}
          </div>
        </div>
      </div>

      {/* Student View Banner - Material v3 warning container */}
      {viewingStudentId && (
        <div className="flex items-center gap-2 px-4 py-2 bg-tertiary-container text-on-tertiary-container rounded-full">
          <span className="text-label-large">Viewing as student</span>
          <button
            onClick={onExitStudentView}
            className="p-1 hover:bg-tertiary/20 rounded-full transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Sync Status - Material v3 label */}
      <div className="flex items-center gap-2 text-body-medium text-on-surface-variant">
        {syncStatus.isSyncing ? (
          <>
            <RefreshCw className="h-4 w-4 animate-spin text-primary" />
            <span>Syncing...</span>
          </>
        ) : syncStatus.error ? (
          <>
            <span className="text-error">Sync error</span>
          </>
        ) : (
          <span>Last sync: {formatSyncTime(syncStatus.lastSyncAt)}</span>
        )}
      </div>

      {/* Actions - Material v3 icon buttons */}
      <div className="flex items-center gap-1">
        {isTeacher && (
          <>
            <button
              onClick={onSync}
              disabled={syncStatus.isSyncing}
              className="btn-icon"
              title="Sync with Google Drive"
            >
              <RefreshCw className={cn("h-5 w-5", syncStatus.isSyncing && "animate-spin")} />
            </button>
            <button
              onClick={onImport}
              className="btn-icon"
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

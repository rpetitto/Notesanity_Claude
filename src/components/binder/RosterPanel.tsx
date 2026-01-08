import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Search, User, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Student {
  id: string
  userId: string
  fullName: string
  email: string
  status: 'active' | 'invited' | 'removed'
}

// Mock students data
const MOCK_STUDENTS: Student[] = [
  { id: 's1', userId: 'u1', fullName: 'Alice Johnson', email: 'alice@school.edu', status: 'active' },
  { id: 's2', userId: 'u2', fullName: 'Bob Smith', email: 'bob@school.edu', status: 'active' },
  { id: 's3', userId: 'u3', fullName: 'Charlie Brown', email: 'charlie@school.edu', status: 'active' },
  { id: 's4', userId: 'u4', fullName: 'Diana Ross', email: 'diana@school.edu', status: 'active' },
  { id: 's5', userId: 'u5', fullName: 'Edward Kim', email: 'edward@school.edu', status: 'active' },
]

interface RosterPanelProps {
  courseId: string
  viewingStudentId: string | null
  onViewStudent: (studentId: string | null) => void
  onClose: () => void
}

export default function RosterPanel({
  courseId,
  viewingStudentId,
  onViewStudent,
  onClose,
}: RosterPanelProps) {
  const [searchQuery, setSearchQuery] = useState('')

  // Fetch students
  const { data: students = MOCK_STUDENTS, isLoading } = useQuery({
    queryKey: ['roster', courseId],
    queryFn: async () => {
      // In real implementation, fetch from base44.entities.CourseMembership.list()
      return MOCK_STUDENTS
    },
    enabled: !!courseId,
  })

  // Filter students by search
  const filteredStudents = students.filter(student =>
    student.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    student.email.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const activeStudents = filteredStudents.filter(s => s.status === 'active')

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header - Material v3 style */}
      <header className="h-14 border-b border-outline-variant flex items-center px-4 gap-3 bg-surface-container-low">
        <h3 className="font-medium text-title-medium text-on-surface">Class Roster</h3>
        <span className="text-body-medium text-on-surface-variant">({activeStudents.length})</span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="btn-icon"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      {/* Search - Material v3 search bar */}
      <div className="p-3 border-b border-outline-variant">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-on-surface-variant" />
          <input
            type="text"
            placeholder="Search students..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 text-body-large bg-surface-container-highest rounded-full
                       focus:outline-none focus:ring-2 focus:ring-primary border-0
                       placeholder:text-on-surface-variant"
          />
        </div>
      </div>

      {/* View All (exit student view) - Material v3 filled tonal style */}
      {viewingStudentId && (
        <button
          onClick={() => onViewStudent(null)}
          className="flex items-center gap-3 px-4 py-4 border-b border-outline-variant bg-secondary-container text-on-secondary-container hover:bg-secondary-container/80 transition-colors"
        >
          <div className="w-10 h-10 bg-secondary rounded-full flex items-center justify-center">
            <User className="h-5 w-5 text-on-secondary" />
          </div>
          <span className="text-label-large font-medium">View Teacher Notebook</span>
        </button>
      )}

      {/* Student List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-on-surface-variant">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-4" />
              <p className="text-body-medium">Loading students...</p>
            </div>
          </div>
        ) : activeStudents.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-on-surface-variant">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-surface-container-highest flex items-center justify-center mx-auto mb-4">
                <User className="h-8 w-8 opacity-40" />
              </div>
              <p className="text-title-medium mb-1">No students found</p>
              <p className="text-body-medium">Try a different search term</p>
            </div>
          </div>
        ) : (
          activeStudents.map((student) => (
            <div
              key={student.id}
              className={cn(
                "group flex items-center gap-3 px-4 py-3 transition-colors cursor-pointer state-layer",
                viewingStudentId === student.userId
                  ? "bg-secondary-container text-on-secondary-container"
                  : "hover:bg-surface-variant text-on-surface"
              )}
              onClick={() => onViewStudent(student.userId)}
            >
              {/* Avatar - Material v3 style */}
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center text-label-large font-medium",
                viewingStudentId === student.userId
                  ? "bg-primary text-on-primary"
                  : "bg-primary-container text-on-primary-container"
              )}>
                {student.fullName.charAt(0)}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-body-large font-medium truncate">{student.fullName}</p>
                <p className="text-body-small text-on-surface-variant truncate">{student.email}</p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onViewStudent(student.userId)
                  }}
                  className="btn-icon"
                  title="View notebook"
                >
                  <Eye className="h-5 w-5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

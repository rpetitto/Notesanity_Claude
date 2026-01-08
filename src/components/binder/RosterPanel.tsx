import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Search, User, Eye, Mail } from 'lucide-react'
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
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="h-12 border-b flex items-center px-4 gap-3">
        <h3 className="font-medium">Class Roster</h3>
        <span className="text-sm text-muted-foreground">({activeStudents.length})</span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="p-1 hover:bg-accent rounded transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* Search */}
      <div className="p-3 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search students..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>
      </div>

      {/* View All (exit student view) */}
      {viewingStudentId && (
        <button
          onClick={() => onViewStudent(null)}
          className="flex items-center gap-3 px-4 py-3 border-b bg-primary/5 text-primary hover:bg-primary/10 transition-colors"
        >
          <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
            <User className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium">View Teacher Notebook</span>
        </button>
      )}

      {/* Student List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            Loading students...
          </div>
        ) : activeStudents.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            No students found
          </div>
        ) : (
          activeStudents.map((student) => (
            <div
              key={student.id}
              className={cn(
                "flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors cursor-pointer",
                viewingStudentId === student.userId && "bg-accent"
              )}
              onClick={() => onViewStudent(student.userId)}
            >
              {/* Avatar */}
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                viewingStudentId === student.userId
                  ? "bg-primary text-white"
                  : "bg-primary/10 text-primary"
              )}>
                {student.fullName.charAt(0)}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{student.fullName}</p>
                <p className="text-xs text-muted-foreground truncate">{student.email}</p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onViewStudent(student.userId)
                  }}
                  className="p-1.5 hover:bg-background rounded transition-colors"
                  title="View notebook"
                >
                  <Eye className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Search, UserPlus, Mail, MoreVertical } from 'lucide-react'
import { base44 } from '@/lib/base44-sdk'
import type { Course, CourseMembership, User } from '@/types'

// Mock students data
const MOCK_STUDENTS = [
  { id: 's1', userId: 'u1', fullName: 'Alice Johnson', email: 'alice@school.edu', status: 'active' as const },
  { id: 's2', userId: 'u2', fullName: 'Bob Smith', email: 'bob@school.edu', status: 'active' as const },
  { id: 's3', userId: 'u3', fullName: 'Charlie Brown', email: 'charlie@school.edu', status: 'active' as const },
  { id: 's4', userId: 'u4', fullName: 'Diana Ross', email: 'diana@school.edu', status: 'invited' as const },
]

export default function Roster() {
  const { courseId } = useParams()
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [user, setUser] = useState<User | null>(null)

  // Fetch user on mount
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await base44.auth.me()
        setUser(userData)
      } catch (err) {
        console.error('Failed to fetch user:', err)
      }
    }
    fetchUser()
  }, [])

  // Fetch course details
  const { data: course } = useQuery<Course | null>({
    queryKey: ['course', courseId],
    queryFn: async () => {
      if (!courseId) return null
      return { id: courseId, name: 'Math 101', section: 'Period 1', status: 'active', created_at: '', updated_at: '' }
    },
    enabled: !!courseId,
  })

  // Fetch course memberships (students)
  const { data: students = MOCK_STUDENTS } = useQuery({
    queryKey: ['students', courseId],
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
  const invitedStudents = filteredStudents.filter(s => s.status === 'invited')

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="h-14 border-b flex items-center px-4 gap-4 bg-card">
        <button
          onClick={() => navigate('/')}
          className="p-2 hover:bg-accent rounded-md transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-lg font-semibold">Class Roster</h1>
          {course && (
            <p className="text-sm text-muted-foreground">
              {course.name} {course.section && `- ${course.section}`}
            </p>
          )}
        </div>
        <div className="flex-1" />
        <button className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors">
          <UserPlus className="h-4 w-4" />
          Invite Students
        </button>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* Search */}
          <div className="relative mb-6">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search students..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          {/* Active Students */}
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-4">
              Active Students ({activeStudents.length})
            </h2>
            <div className="bg-card border rounded-lg divide-y">
              {activeStudents.map((student) => (
                <div
                  key={student.id}
                  className="flex items-center gap-4 p-4 hover:bg-accent/50 transition-colors"
                >
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center text-primary font-medium">
                    {student.fullName.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{student.fullName}</p>
                    <p className="text-sm text-muted-foreground truncate">{student.email}</p>
                  </div>
                  <button
                    onClick={() => navigate(`/?viewStudent=${student.userId}`)}
                    className="px-3 py-1 text-sm border rounded-md hover:bg-accent transition-colors"
                  >
                    View Notebook
                  </button>
                  <button className="p-2 hover:bg-accent rounded-md transition-colors">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                  </button>
                  <button className="p-2 hover:bg-accent rounded-md transition-colors">
                    <MoreVertical className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
              ))}
              {activeStudents.length === 0 && (
                <div className="p-8 text-center text-muted-foreground">
                  No active students found
                </div>
              )}
            </div>
          </section>

          {/* Invited Students */}
          {invitedStudents.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-4">
                Pending Invitations ({invitedStudents.length})
              </h2>
              <div className="bg-card border rounded-lg divide-y">
                {invitedStudents.map((student) => (
                  <div
                    key={student.id}
                    className="flex items-center gap-4 p-4 hover:bg-accent/50 transition-colors"
                  >
                    <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center text-muted-foreground font-medium">
                      {student.fullName.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{student.fullName}</p>
                      <p className="text-sm text-muted-foreground truncate">{student.email}</p>
                    </div>
                    <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-md">
                      Invited
                    </span>
                    <button className="px-3 py-1 text-sm border rounded-md hover:bg-accent transition-colors">
                      Resend Invite
                    </button>
                    <button className="p-2 hover:bg-accent rounded-md transition-colors">
                      <MoreVertical className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

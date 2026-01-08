import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { base44 } from '@/lib/base44-sdk'
import type { Course, Section, Page, Folder, User, SyncStatus, CourseMembership } from '@/types'
import TopBar from '@/components/binder/TopBar'
import SectionTabs from '@/components/binder/SectionTabs'
import PageList from '@/components/binder/PageList'
import PageViewer from '@/components/binder/PageViewer'
import RosterPanel from '@/components/binder/RosterPanel'
import CommentsPanel from '@/components/binder/CommentsPanel'
import ImportDialog from '@/components/binder/ImportDialog'

// Mock data for development
const MOCK_COURSES: Course[] = [
  { id: '1', name: 'Math 101', section: 'Period 1', status: 'active', created_at: '', updated_at: '' },
  { id: '2', name: 'Science 202', section: 'Period 2', status: 'active', created_at: '', updated_at: '' },
]

const MOCK_SECTIONS: Section[] = [
  { id: 's1', binderId: 'b1', title: 'General', orderIndex: 0, isSystem: true, systemKey: 'GENERAL', published: true, origin: 'APP', managedByApp: true, created_at: '', updated_at: '' },
  { id: 's2', binderId: 'b1', title: 'Assignments', orderIndex: 1, isSystem: true, systemKey: 'ASSIGNMENTS', published: true, origin: 'APP', managedByApp: true, created_at: '', updated_at: '' },
  { id: 's3', binderId: 'b1', title: 'Unit 1: Algebra', orderIndex: 2, isSystem: false, published: true, origin: 'APP', managedByApp: true, color: '#4285f4', created_at: '', updated_at: '' },
]

const MOCK_PAGES: Page[] = [
  { id: 'p1', binderId: 'b1', sectionId: 's1', title: 'Course Syllabus', orderIndex: 0, pageType: 'DRIVE_FILE', originType: 'TEACHER_DISTRIBUTED', distributionType: 'REFERENCE', distributionStatus: 'viewOnlyDistributed', moveScope: 'FULL', origin: 'APP', managedByApp: true, driveMimeType: 'application/vnd.google-apps.document', created_at: '', updated_at: '' },
  { id: 'p2', binderId: 'b1', sectionId: 's1', title: 'Welcome Notes', orderIndex: 1, pageType: 'DRIVE_FILE', originType: 'STUDENT_ADDED', distributionType: 'NONE', distributionStatus: 'private', moveScope: 'FULL', origin: 'APP', managedByApp: true, driveMimeType: 'application/vnd.google-apps.document', created_at: '', updated_at: '' },
  { id: 'p3', binderId: 'b1', sectionId: 's2', title: 'Homework 1', orderIndex: 0, pageType: 'DRIVE_FILE', originType: 'TEACHER_DISTRIBUTED', distributionType: 'TEMPLATE_COPY', distributionStatus: 'copyDistributed', moveScope: 'FULL', origin: 'APP', managedByApp: true, driveMimeType: 'application/vnd.google-apps.spreadsheet', created_at: '', updated_at: '' },
  { id: 'p4', binderId: 'b1', sectionId: 's3', title: 'Chapter 1 Notes', orderIndex: 0, pageType: 'CANVAS', originType: 'STUDENT_ADDED', distributionType: 'NONE', distributionStatus: 'private', moveScope: 'FULL', origin: 'APP', managedByApp: true, created_at: '', updated_at: '' },
]

export default function Home() {
  const queryClient = useQueryClient()

  // User state
  const [user, setUser] = useState<User | null>(null)

  // Selection state
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)

  // UI state
  const [searchQuery, setSearchQuery] = useState('')
  const [showRoster, setShowRoster] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [viewingStudentId, setViewingStudentId] = useState<string | null>(null)

  // Sync status
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ isSyncing: false })

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

  // Queries - using mock data for now
  const { data: courses = MOCK_COURSES } = useQuery({
    queryKey: ['courses'],
    queryFn: async () => {
      // In real implementation, fetch from base44.entities.Course.list()
      return MOCK_COURSES
    },
  })

  const { data: sections = MOCK_SECTIONS } = useQuery({
    queryKey: ['sections', selectedCourseId],
    queryFn: async () => {
      // In real implementation, fetch sections for the selected course's binder
      return MOCK_SECTIONS
    },
    enabled: !!selectedCourseId,
  })

  const { data: pages = MOCK_PAGES } = useQuery({
    queryKey: ['pages', selectedCourseId],
    queryFn: async () => {
      // In real implementation, fetch pages for the selected course's binder
      return MOCK_PAGES
    },
    enabled: !!selectedCourseId,
  })

  const { data: folders = [] } = useQuery<Folder[]>({
    queryKey: ['folders', selectedCourseId],
    queryFn: async () => {
      // In real implementation, fetch folders for the selected course's binder
      return []
    },
    enabled: !!selectedCourseId,
  })

  const { data: courseMembership } = useQuery<CourseMembership | null>({
    queryKey: ['membership', selectedCourseId, user?.id],
    queryFn: async () => {
      // In real implementation, fetch course membership
      // For now, assume user is a teacher
      return {
        id: 'cm1',
        courseId: selectedCourseId!,
        userId: user?.id || '',
        roleInCourse: 'TEACHER' as const,
        status: 'active' as const,
        created_at: '',
        updated_at: '',
      }
    },
    enabled: !!selectedCourseId && !!user,
  })

  // Derived state
  const isTeacher = courseMembership?.roleInCourse === 'TEACHER' || courseMembership?.roleInCourse === 'CO_TEACHER'
  const showTeacherControls = isTeacher && !viewingStudentId

  const selectedCourse = useMemo(
    () => courses.find(c => c.id === selectedCourseId) || null,
    [courses, selectedCourseId]
  )

  const activeSections = useMemo(
    () => sections.filter(s => !s.deletedAt).sort((a, b) => a.orderIndex - b.orderIndex),
    [sections]
  )

  const selectedSection = useMemo(
    () => activeSections.find(s => s.id === selectedSectionId) || null,
    [activeSections, selectedSectionId]
  )

  const sectionPages = useMemo(
    () => pages
      .filter(p => p.sectionId === selectedSectionId && !p.deletedAt)
      .filter(p => !searchQuery || p.title.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => a.orderIndex - b.orderIndex),
    [pages, selectedSectionId, searchQuery]
  )

  const sectionFolders = useMemo(
    () => folders
      .filter(f => f.sectionId === selectedSectionId && !f.deletedAt)
      .sort((a, b) => a.orderIndex - b.orderIndex),
    [folders, selectedSectionId]
  )

  const selectedPage = useMemo(
    () => pages.find(p => p.id === selectedPageId) || null,
    [pages, selectedPageId]
  )

  // Mutations
  const syncMutation = useMutation({
    mutationFn: async () => {
      setSyncStatus({ isSyncing: true })
      await base44.functions.invoke('syncDrive', { binderId: selectedCourse?.id })
    },
    onSuccess: () => {
      setSyncStatus({ isSyncing: false, lastSyncAt: new Date().toISOString() })
      queryClient.invalidateQueries({ queryKey: ['pages'] })
      queryClient.invalidateQueries({ queryKey: ['folders'] })
      toast.success('Sync completed successfully')
    },
    onError: (error) => {
      setSyncStatus({ isSyncing: false, error: String(error) })
      toast.error('Sync failed')
    },
  })

  // Auto-select first course if none selected
  useEffect(() => {
    if (courses.length > 0 && !selectedCourseId) {
      setSelectedCourseId(courses[0].id)
    }
  }, [courses, selectedCourseId])

  // Auto-select first section when course changes
  useEffect(() => {
    if (activeSections.length > 0 && !selectedSectionId) {
      setSelectedSectionId(activeSections[0].id)
    }
  }, [activeSections, selectedSectionId])

  // Handlers
  const handleCourseChange = (courseId: string) => {
    setSelectedCourseId(courseId)
    setSelectedSectionId(null)
    setSelectedPageId(null)
    setViewingStudentId(null)
    setShowRoster(false)
  }

  const handleSectionSelect = (sectionId: string) => {
    setSelectedSectionId(sectionId)
    setSelectedPageId(null)
  }

  const handlePageSelect = (pageId: string) => {
    setSelectedPageId(pageId)
    setShowComments(false)
  }

  const handleSync = () => {
    syncMutation.mutate()
  }

  const handleImport = async (googleCourseId: string, courseName: string) => {
    try {
      await base44.functions.invoke('importCourse', { googleCourseId, courseName })
      queryClient.invalidateQueries({ queryKey: ['courses'] })
      toast.success('Course imported successfully')
      setShowImportDialog(false)
    } catch (error) {
      toast.error('Failed to import course')
    }
  }

  const handleViewStudent = (studentId: string | null) => {
    setViewingStudentId(studentId)
    if (studentId) {
      setShowRoster(false)
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Top Bar */}
      <TopBar
        courses={courses}
        selectedCourseId={selectedCourseId}
        onCourseChange={handleCourseChange}
        syncStatus={syncStatus}
        onSync={handleSync}
        onImport={() => setShowImportDialog(true)}
        isTeacher={showTeacherControls}
        viewingStudentId={viewingStudentId}
        onExitStudentView={() => setViewingStudentId(null)}
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Section Tabs + Page List */}
        <div className="w-80 border-r flex flex-col bg-card">
          {selectedCourseId && (
            <>
              <SectionTabs
                sections={activeSections}
                selectedSectionId={selectedSectionId}
                onSectionSelect={handleSectionSelect}
                isTeacher={showTeacherControls}
                binderId={selectedCourse?.id || ''}
                onShowRoster={() => setShowRoster(!showRoster)}
                showingRoster={showRoster}
              />
              <PageList
                pages={sectionPages}
                folders={sectionFolders}
                selectedPageId={selectedPageId}
                onPageSelect={handlePageSelect}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                isTeacher={showTeacherControls}
                sectionId={selectedSectionId || ''}
                binderId={selectedCourse?.id || ''}
              />
            </>
          )}
        </div>

        {/* Center Panel - Page Viewer */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <PageViewer
            page={selectedPage}
            isTeacher={showTeacherControls}
            onShowComments={() => setShowComments(!showComments)}
            showingComments={showComments}
            courseId={selectedCourseId || ''}
          />
        </div>

        {/* Right Panel - Roster or Comments */}
        {(showRoster || showComments) && (
          <div className="w-80 border-l bg-card">
            {showRoster && isTeacher && (
              <RosterPanel
                courseId={selectedCourseId || ''}
                viewingStudentId={viewingStudentId}
                onViewStudent={handleViewStudent}
                onClose={() => setShowRoster(false)}
              />
            )}
            {showComments && selectedPage && (
              <CommentsPanel
                pageId={selectedPage.id}
                onClose={() => setShowComments(false)}
              />
            )}
          </div>
        )}
      </div>

      {/* Import Dialog */}
      <ImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onImport={handleImport}
      />
    </div>
  )
}

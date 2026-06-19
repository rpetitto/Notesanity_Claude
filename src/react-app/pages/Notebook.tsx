import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft, ChevronRight, ExternalLink, FilePlus, FolderPlus, MoreVertical, Plus, Trash2,
  Users, UserCircle2, X, ArrowLeft, ArrowRight,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { toast } from 'sonner'
import AppShell, { Avatar } from '../components/AppShell'
import {
  ROOT_TAB_ID, createPage, createTab, deletePage, deleteTab, getClass, getClassForStudent,
  getPages, getStudent, getStudents, getTabs, movePage, renamePage, renameTab,
} from '../lib/api'
import type { ClassNotebook, Page, Student, Tab } from '../lib/types'
import { cn, relativeTime } from '../lib/utils'

interface Props { browseMode?: boolean }

export default function NotebookView({ browseMode }: Props) {
  const { classId = '', studentId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data: cls, error: classError } = useQuery({
    queryKey: browseMode ? ['class-for-student', classId, studentId] : ['class', classId],
    queryFn: () => (browseMode ? getClassForStudent(classId, studentId) : getClass(classId)),
    enabled: Boolean(classId && (!browseMode || studentId)),
  })

  const { data: students = [] } = useQuery({
    queryKey: ['students', classId],
    queryFn: () => getStudents(classId),
    enabled: Boolean(classId && browseMode),
  })
  const { data: student } = useQuery({
    queryKey: ['student', classId, studentId],
    queryFn: () => getStudent(classId, studentId),
    enabled: Boolean(browseMode && classId && studentId),
  })

  const { data: tabs = [] } = useQuery({
    queryKey: ['tabs', classId, cls?.classFolderId, browseMode ? 'counts' : 'plain'],
    queryFn: () => getTabs(classId, { withCounts: !!browseMode, classFolderId: cls?.classFolderId }),
    enabled: Boolean(cls?.classFolderId),
  })

  const desiredTabName = searchParams.get('tab')
  const desiredPageTitle = searchParams.get('page')

  const [activeTabId, setActiveTabId] = useState<string>(ROOT_TAB_ID)
  useEffect(() => {
    if (!tabs.length) return
    if (desiredTabName) {
      const match = tabs.find((t) => t.name === desiredTabName)
      if (match) { setActiveTabId(match.id); return }
    }
    if (!tabs.find((t) => t.id === activeTabId)) setActiveTabId(tabs[0].id)
  }, [tabs, desiredTabName, activeTabId])

  const { data: pages = [] } = useQuery({
    queryKey: ['pages', classId, cls?.classFolderId, activeTabId],
    queryFn: () => getPages(classId, activeTabId, { classFolderId: cls?.classFolderId }),
    enabled: Boolean(cls?.classFolderId && activeTabId),
  })

  const [activePageId, setActivePageId] = useState<string | null>(null)
  useEffect(() => {
    if (!pages.length) { setActivePageId(null); return }
    if (desiredPageTitle) {
      const match = pages.find((p) => p.title === desiredPageTitle)
      if (match) { setActivePageId(match.id); return }
    }
    if (!activePageId || !pages.find((p) => p.id === activePageId)) setActivePageId(pages[0].id)
  }, [pages, desiredPageTitle, activePageId])

  const activePage = pages.find((p) => p.id === activePageId) ?? null
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const idx = activePage ? pages.findIndex((p) => p.id === activePage.id) : -1

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    if (activeTab && activeTab.id !== ROOT_TAB_ID) next.set('tab', activeTab.name)
    else next.delete('tab')
    if (activePage) next.set('page', activePage.title)
    else next.delete('page')
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true })
  }, [activeTab, activePage, searchParams, setSearchParams])

  const goPrev = () => { if (idx > 0) setActivePageId(pages[idx - 1].id) }
  const goNext = () => { if (idx >= 0 && idx < pages.length - 1) setActivePageId(pages[idx + 1].id) }

  const studentIdx = useMemo(
    () => (browseMode && studentId ? students.findIndex((s) => s.userId === studentId) : -1),
    [browseMode, studentId, students],
  )
  const prevStudent = studentIdx > 0 ? students[studentIdx - 1] : null
  const nextStudent = studentIdx >= 0 && studentIdx < students.length - 1 ? students[studentIdx + 1] : null
  const gotoStudent = (s: Student) => {
    const search = new URLSearchParams()
    if (activeTab && activeTab.id !== ROOT_TAB_ID) search.set('tab', activeTab.name)
    if (activePage) search.set('page', activePage.title)
    const qs = search.toString()
    navigate(`/notebooks/${classId}/students/${s.userId}${qs ? `?${qs}` : ''}`)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const newPage = useMutation({
    mutationFn: () => createPage(classId, activeTabId),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['pages', classId] })
      qc.invalidateQueries({ queryKey: ['tabs', classId] })
      setActivePageId(p.id)
      toast.success('New page created')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not create page'),
  })

  const newTab = useMutation({
    mutationFn: (name: string) => createTab(classId, name),
    onSuccess: (t) => { qc.invalidateQueries({ queryKey: ['tabs', classId] }); setActiveTabId(t.id); toast.success('Tab added') },
    onError: (e: any) => toast.error(e?.message ?? 'Could not create tab'),
  })

  const renamePageM = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renamePage(classId, id, title),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pages', classId] }),
  })

  const deletePageM = useMutation({
    mutationFn: (id: string) => deletePage(classId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pages', classId] })
      qc.invalidateQueries({ queryKey: ['tabs', classId] })
      toast.success('Page moved to trash')
    },
  })

  const renameTabM = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameTab(classId, id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tabs', classId] }),
  })

  const deleteTabM = useMutation({
    mutationFn: (id: string) => deleteTab(classId, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tabs', classId] }); setActiveTabId(ROOT_TAB_ID); toast.success('Tab moved to trash') },
  })

  const movePageM = useMutation({
    mutationFn: ({ id, toTabId }: { id: string; toTabId: string }) => movePage(classId, id, toTabId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pages', classId] })
      qc.invalidateQueries({ queryKey: ['tabs', classId] })
      toast.success('Page moved')
    },
  })

  const [rosterOpen, setRosterOpen] = useState(false)
  const accent = cls?.accentColor ?? '#1A73E8'

  const topBar = (
    <div className="flex flex-col">
      <div className="h-1" style={{ background: accent }} />
      {browseMode ? (
        <StudentBanner
          student={student}
          cls={cls ?? null}
          accent={accent}
          onExit={() => navigate(`/notebooks/${classId}/students`)}
          onOpenRoster={() => setRosterOpen(true)}
          prevStudent={prevStudent}
          nextStudent={nextStudent}
          onPrevStudent={prevStudent ? () => gotoStudent(prevStudent) : undefined}
          onNextStudent={nextStudent ? () => gotoStudent(nextStudent) : undefined}
          position={studentIdx >= 0 ? `${studentIdx + 1} / ${students.length}` : undefined}
        />
      ) : (
        <div className="flex items-center justify-between px-6 h-14">
          <div className="flex items-center gap-2 text-sm">
            <button onClick={() => navigate('/notebooks')} className="text-[#5F6368] hover:text-[#202124]">
              Notebooks
            </button>
            <span className="text-[#5F6368]">›</span>
            <span className="font-medium">{cls?.name ?? '…'}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => newPage.mutate()}
              disabled={newPage.isPending}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-[#1A73E8] text-white text-sm font-medium hover:bg-[#1765c1] disabled:opacity-50"
            >
              <Plus className="w-4 h-4" /> New page
            </button>
          </div>
        </div>
      )}
    </div>
  )

  if (classError) {
    return (
      <AppShell topBar={topBar}>
        <div className="m-6 bg-white border border-[#FCE8E6] text-[#D93025] rounded-xl p-6">
          <div className="font-medium">Couldn't load this notebook</div>
          <div className="text-sm mt-1 text-[#5F6368]">{(classError as Error).message}</div>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell topBar={topBar}>
      <div className="grid grid-cols-[260px_300px_1fr] h-full min-h-0">
        <TabPane
          tabs={tabs}
          activeId={activeTabId}
          onSelect={setActiveTabId}
          onCreate={(name) => newTab.mutate(name)}
          onRename={(id, name) => renameTabM.mutate({ id, name })}
          onDelete={(id) => deleteTabM.mutate(id)}
          readOnly={browseMode}
          showCounts={browseMode}
        />
        <PagePane
          pages={pages}
          activeId={activePageId}
          tabs={tabs}
          onSelect={setActivePageId}
          onCreate={() => newPage.mutate()}
          onRename={(id, title) => renamePageM.mutate({ id, title })}
          onDelete={(id) => deletePageM.mutate(id)}
          onMove={(id, toTabId) => movePageM.mutate({ id, toTabId })}
          readOnly={browseMode}
        />
        <ReaderPane
          page={activePage}
          mode={browseMode ? 'preview' : 'edit'}
          hasPrev={idx > 0}
          hasNext={idx >= 0 && idx < pages.length - 1}
          onPrev={goPrev}
          onNext={goNext}
        />
      </div>
      {browseMode && (
        <RosterDrawer
          open={rosterOpen}
          onClose={() => setRosterOpen(false)}
          students={students}
          activeId={studentId}
          onSelect={(s) => { setRosterOpen(false); gotoStudent(s) }}
        />
      )}
    </AppShell>
  )
}

function StudentBanner({
  student, cls, accent, onExit, onOpenRoster,
  prevStudent, nextStudent, onPrevStudent, onNextStudent, position,
}: {
  student?: Student
  cls: ClassNotebook | null
  accent: string
  onExit: () => void
  onOpenRoster: () => void
  prevStudent: Student | null
  nextStudent: Student | null
  onPrevStudent?: () => void
  onNextStudent?: () => void
  position?: string
}) {
  return (
    <div style={{ background: `${accent}10` }} className="border-b border-[#E8EAED]">
      <div className="flex items-center justify-between px-6 py-3 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-xs uppercase tracking-wide font-medium text-[#5F6368] hidden sm:block">
            Viewing student
          </div>
          <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-white border border-[#DADCE0] shadow-sm min-w-0">
            <Avatar name={student?.name ?? '?'} picture={student?.photoUrl} size={32} />
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate max-w-[16rem]">{student?.name ?? 'Loading…'}</div>
              <div className="text-[11px] text-[#5F6368] truncate max-w-[16rem]">
                {cls?.name}{cls?.subtitle ? ` · ${cls.subtitle}` : ''}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPrevStudent}
            disabled={!prevStudent}
            title={prevStudent ? `Previous: ${prevStudent.name}` : 'No previous student'}
            className="inline-flex items-center gap-1 h-9 px-2.5 rounded-full text-sm border border-[#DADCE0] bg-white hover:bg-[#F1F3F4] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden md:inline">Prev student</span>
          </button>
          {position && (
            <span className="px-2 text-xs text-[#5F6368] tabular-nums whitespace-nowrap">{position}</span>
          )}
          <button
            type="button"
            onClick={onNextStudent}
            disabled={!nextStudent}
            title={nextStudent ? `Next: ${nextStudent.name}` : 'No next student'}
            className="inline-flex items-center gap-1 h-9 px-2.5 rounded-full text-sm border border-[#DADCE0] bg-white hover:bg-[#F1F3F4] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="hidden md:inline">Next student</span>
            <ArrowRight className="w-4 h-4" />
          </button>
          <span className="w-px h-6 bg-[#E8EAED] mx-1" />
          <button
            type="button"
            onClick={onOpenRoster}
            className="inline-flex items-center gap-1 h-9 px-3 rounded-full text-sm border border-[#DADCE0] bg-white hover:bg-[#F1F3F4]"
          >
            <Users className="w-4 h-4" /> Roster
          </button>
          <button
            type="button"
            onClick={onExit}
            title="Exit student view"
            className="inline-flex items-center gap-1 h-9 px-3 rounded-full text-sm text-[#5F6368] hover:bg-[#F1F3F4]"
          >
            <X className="w-4 h-4" /> Exit
          </button>
        </div>
      </div>
    </div>
  )
}

function RosterDrawer({
  open, onClose, students, activeId, onSelect,
}: {
  open: boolean; onClose: () => void
  students: Student[]; activeId: string; onSelect: (s: Student) => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-[340px] bg-white border-l border-[#E8EAED] shadow-elevation-3 flex flex-col">
        <div className="flex items-center justify-between px-4 h-14 border-b border-[#E8EAED]">
          <div className="flex items-center gap-2">
            <UserCircle2 className="w-5 h-5 text-[#5F6368]" />
            <div className="font-medium">Class roster</div>
            <span className="text-xs text-[#5F6368]">{students.length}</span>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-[#F1F3F4]" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {students.map((s) => (
            <button
              key={s.userId}
              onClick={() => onSelect(s)}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-2.5 text-left border-l-2',
                s.userId === activeId ? 'bg-[#E8F0FE] border-[#1A73E8]' : 'border-transparent hover:bg-[#F1F3F4]',
              )}
            >
              <Avatar name={s.name} picture={s.photoUrl} size={36} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{s.name}</div>
                {s.email && <div className="text-xs text-[#5F6368] truncate">{s.email}</div>}
              </div>
            </button>
          ))}
        </div>
      </aside>
    </div>
  )
}

function TabPane({
  tabs, activeId, onSelect, onCreate, onRename, onDelete, readOnly, showCounts,
}: {
  tabs: Tab[]; activeId: string; onSelect: (id: string) => void
  onCreate: (name: string) => void; onRename: (id: string, name: string) => void
  onDelete: (id: string) => void; readOnly?: boolean; showCounts?: boolean
}) {
  return (
    <div className="border-r border-[#E8EAED] bg-white flex flex-col min-h-0">
      <div className="px-4 py-3 text-xs uppercase tracking-wide text-[#5F6368] font-medium">Tabs</div>
      <div className="flex-1 overflow-y-auto">
        {tabs.map((t) => (
          <TabRow
            key={t.id}
            tab={t}
            active={t.id === activeId}
            onSelect={() => onSelect(t.id)}
            onRename={(name) => onRename(t.id, name)}
            onDelete={() => onDelete(t.id)}
            readOnly={readOnly}
            showCount={showCounts}
          />
        ))}
      </div>
      {!readOnly && (
        <button
          type="button"
          onClick={() => {
            const name = window.prompt('Tab name')?.trim()
            if (name) onCreate(name)
          }}
          className="m-3 inline-flex items-center justify-center gap-2 h-10 rounded-lg border border-dashed border-[#DADCE0] text-sm text-[#5F6368] hover:bg-[#F1F3F4]"
        >
          <FolderPlus className="w-4 h-4" /> New tab
        </button>
      )}
    </div>
  )
}

function TabRow({
  tab, active, onSelect, onRename, onDelete, readOnly, showCount,
}: {
  tab: Tab; active: boolean; onSelect: () => void
  onRename: (name: string) => void; onDelete: () => void
  readOnly?: boolean; showCount?: boolean
}) {
  return (
    <div
      className={cn(
        'group flex items-center px-4 h-9 text-sm cursor-pointer',
        active ? 'bg-[#E8F0FE] text-[#1A73E8] font-medium' : 'hover:bg-[#F1F3F4]',
      )}
      onClick={onSelect}
    >
      <span className="truncate flex-1">{tab.name}</span>
      {showCount && typeof tab.pageCount === 'number' && (
        <span
          className={cn(
            'ml-2 text-xs px-1.5 py-0.5 rounded-full tabular-nums',
            active ? 'bg-white text-[#1A73E8] border border-[#1A73E8]/30' : 'bg-[#F1F3F4] text-[#5F6368]',
          )}
          title={`${tab.pageCount} page${tab.pageCount === 1 ? '' : 's'}`}
        >
          {tab.pageCount}
        </span>
      )}
      {tab.id !== ROOT_TAB_ID && !readOnly && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button onClick={(e) => e.stopPropagation()} className="opacity-0 group-hover:opacity-100 ml-1 p-1 rounded hover:bg-white text-[#5F6368]" aria-label="Tab menu">
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              className="min-w-[160px] bg-white rounded-lg shadow-elevation-3 border border-[#E8EAED] py-1 text-sm"
            >
              <DropdownMenu.Item
                className="px-3 py-2 outline-none data-[highlighted]:bg-[#F1F3F4] cursor-pointer"
                onSelect={() => {
                  const name = window.prompt('Rename tab', tab.name)?.trim()
                  if (name) onRename(name)
                }}
              >
                Rename
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="px-3 py-2 outline-none data-[highlighted]:bg-[#F1F3F4] cursor-pointer text-[#D93025]"
                onSelect={() => { if (window.confirm(`Move "${tab.name}" to trash?`)) onDelete() }}
              >
                Delete tab
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  )
}

function PagePane({
  pages, activeId, tabs, onSelect, onCreate, onRename, onDelete, onMove, readOnly,
}: {
  pages: Page[]; activeId: string | null; tabs: Tab[]
  onSelect: (id: string) => void; onCreate: () => void
  onRename: (id: string, title: string) => void; onDelete: (id: string) => void
  onMove: (id: string, toTabId: string) => void; readOnly?: boolean
}) {
  return (
    <div className="border-r border-[#E8EAED] bg-white flex flex-col min-h-0">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="text-xs uppercase tracking-wide text-[#5F6368] font-medium">Pages</div>
        {!readOnly && (
          <button
            onClick={onCreate}
            className="inline-flex items-center gap-1 text-xs text-[#1A73E8] hover:underline"
          >
            <FilePlus className="w-3.5 h-3.5" /> New
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {pages.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-[#5F6368]">
            No pages yet.
            {!readOnly && <button onClick={onCreate} className="block mx-auto mt-3 text-[#1A73E8] hover:underline">Create the first page</button>}
          </div>
        )}
        {pages.map((p) => (
          <div
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={cn(
              'group px-4 py-2.5 cursor-pointer border-l-2',
              p.id === activeId ? 'border-[#1A73E8] bg-[#F8FBFF]' : 'border-transparent hover:bg-[#F8F9FA]',
            )}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate" title={p.title}>{p.title}</div>
                <div className="text-xs text-[#5F6368] mt-0.5">{relativeTime(p.modifiedTime)}</div>
              </div>
              {!readOnly && (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button onClick={(e) => e.stopPropagation()} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white text-[#5F6368]" aria-label="Page menu">
                      <MoreVertical className="w-3.5 h-3.5" />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content align="end" className="min-w-[180px] bg-white rounded-lg shadow-elevation-3 border border-[#E8EAED] py-1 text-sm">
                      <DropdownMenu.Item
                        className="px-3 py-2 outline-none data-[highlighted]:bg-[#F1F3F4] cursor-pointer"
                        onSelect={() => {
                          const t = window.prompt('Rename page', p.title)?.trim()
                          if (t) onRename(p.id, t)
                        }}
                      >
                        Rename
                      </DropdownMenu.Item>
                      <DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger className="px-3 py-2 outline-none data-[highlighted]:bg-[#F1F3F4] cursor-pointer flex items-center justify-between">
                          Move to tab <ChevronRight className="w-3.5 h-3.5" />
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.SubContent className="min-w-[180px] bg-white rounded-lg shadow-elevation-3 border border-[#E8EAED] py-1 text-sm">
                            {tabs.map((t) => (
                              <DropdownMenu.Item
                                key={t.id}
                                className="px-3 py-2 outline-none data-[highlighted]:bg-[#F1F3F4] cursor-pointer"
                                onSelect={() => onMove(p.id, t.id)}
                              >
                                {t.name}
                              </DropdownMenu.Item>
                            ))}
                          </DropdownMenu.SubContent>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Sub>
                      <DropdownMenu.Item
                        className="px-3 py-2 outline-none data-[highlighted]:bg-[#F1F3F4] cursor-pointer"
                        onSelect={() => window.open(`https://docs.google.com/document/d/${p.id}/edit`, '_blank')}
                      >
                        Open in new tab
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator className="h-px bg-[#E8EAED] my-1" />
                      <DropdownMenu.Item
                        className="px-3 py-2 outline-none data-[highlighted]:bg-[#F1F3F4] cursor-pointer text-[#D93025] flex items-center gap-2"
                        onSelect={() => { if (window.confirm(`Move "${p.title}" to trash?`)) onDelete(p.id) }}
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ReaderPane({
  page, mode, hasPrev, hasNext, onPrev, onNext,
}: {
  page: Page | null; mode: 'edit' | 'preview'
  hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void
}) {
  const src = useMemo(() => {
    if (!page) return null
    return mode === 'edit'
      ? `https://docs.google.com/document/d/${page.id}/edit?rm=embedded&embedded=true`
      : `https://drive.google.com/file/d/${page.id}/preview`
  }, [page, mode])

  if (!page) {
    return (
      <div className="flex flex-col items-center justify-center text-[#5F6368] bg-[#FBFAF5]">
        <div className="text-sm">Select a page to start reading.</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-0 bg-[#FBFAF5]">
      <div className="flex items-center justify-between px-4 h-12 bg-white border-b border-[#E8EAED]">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={onPrev} disabled={!hasPrev} className="p-1.5 rounded-full hover:bg-[#F1F3F4] disabled:opacity-30" aria-label="Previous page">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={onNext} disabled={!hasNext} className="p-1.5 rounded-full hover:bg-[#F1F3F4] disabled:opacity-30" aria-label="Next page">
            <ChevronRight className="w-4 h-4" />
          </button>
          <div className="text-sm font-medium truncate ml-2">{page.title}</div>
        </div>
        <a
          href={`https://docs.google.com/document/d/${page.id}/edit`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-[#5F6368] hover:text-[#202124]"
        >
          Open in Drive <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
      <iframe
        key={src ?? ''}
        src={src ?? undefined}
        title={page.title}
        className="flex-1 w-full bg-white"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  )
}

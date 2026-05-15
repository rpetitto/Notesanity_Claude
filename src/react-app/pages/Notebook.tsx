import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft, ChevronRight, ExternalLink, FilePlus, FolderPlus, MoreVertical, Plus, Trash2,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { toast } from 'sonner'
import AppShell from '../components/AppShell'
import {
  ROOT_TAB_ID, createPage, createTab, deletePage, deleteTab, getClass, getPages, getTabs,
  movePage, renamePage, renameTab,
} from '../lib/api'
import type { Page, Tab } from '../lib/types'
import { cn, relativeTime } from '../lib/utils'

interface Props { browseMode?: boolean }

export default function NotebookView({ browseMode }: Props) {
  const { classId = '', studentId } = useParams()
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data: cls } = useQuery({ queryKey: ['class', classId], queryFn: () => getClass(classId) })
  const { data: tabs = [] } = useQuery({ queryKey: ['tabs', classId], queryFn: () => getTabs(classId), enabled: Boolean(classId) })

  const [activeTabId, setActiveTabId] = useState<string>(ROOT_TAB_ID)
  useEffect(() => { if (tabs[0] && !tabs.find((t) => t.id === activeTabId)) setActiveTabId(tabs[0].id) }, [tabs, activeTabId])

  const { data: pages = [] } = useQuery({
    queryKey: ['pages', classId, activeTabId],
    queryFn: () => getPages(classId, activeTabId),
    enabled: Boolean(classId && activeTabId),
  })

  const [activePageId, setActivePageId] = useState<string | null>(null)
  useEffect(() => {
    if (!pages.length) { setActivePageId(null); return }
    if (!activePageId || !pages.find((p) => p.id === activePageId)) setActivePageId(pages[0].id)
  }, [pages, activePageId])

  const activePage = pages.find((p) => p.id === activePageId) ?? null
  const idx = activePage ? pages.findIndex((p) => p.id === activePage.id) : -1

  const goPrev = () => { if (idx > 0) setActivePageId(pages[idx - 1].id) }
  const goNext = () => { if (idx >= 0 && idx < pages.length - 1) setActivePageId(pages[idx + 1].id) }

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
      qc.invalidateQueries({ queryKey: ['pages', classId, activeTabId] })
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pages', classId, activeTabId] }),
  })

  const deletePageM = useMutation({
    mutationFn: (id: string) => deletePage(classId, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pages', classId, activeTabId] }); toast.success('Page moved to trash') },
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
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['pages', classId, activeTabId] })
      qc.invalidateQueries({ queryKey: ['pages', classId, vars.toTabId] })
      qc.invalidateQueries({ queryKey: ['tabs', classId] })
      toast.success('Page moved')
    },
  })

  const accent = cls?.accentColor ?? '#1A73E8'

  const topBar = (
    <div className="flex flex-col">
      <div className="h-1" style={{ background: accent }} />
      <div className="flex items-center justify-between px-6 h-15 py-2">
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => navigate('/notebooks')} className="text-[#5F6368] hover:text-[#202124]">
            Notebooks
          </button>
          <span className="text-[#5F6368]">›</span>
          <span className="font-medium">{cls?.name ?? '…'}</span>
          {browseMode && (
            <span className="ml-3 text-xs px-2 py-0.5 rounded-full bg-[#FEF7E0] text-[#B06000] border border-[#FDE293]">
              Viewing as teacher
            </span>
          )}
        </div>
        {!browseMode && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => newPage.mutate()}
              disabled={newPage.isPending}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-[#1A73E8] text-white text-sm font-medium hover:bg-[#1765c1] disabled:opacity-50"
            >
              <Plus className="w-4 h-4" /> New page
            </button>
          </div>
        )}
      </div>
      {browseMode && studentId && (
        <BrowseBanner studentId={studentId} accent={accent} onExit={() => navigate(`/notebooks/${classId}/students`)} />
      )}
    </div>
  )

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
    </AppShell>
  )
}

function BrowseBanner({ studentId, accent, onExit }: { studentId: string; accent: string; onExit: () => void }) {
  return (
    <div className="px-6 py-2 text-sm flex items-center justify-between" style={{ background: `${accent}15`, color: accent }}>
      <div>You're viewing student <span className="font-medium">{studentId}</span>'s notebook</div>
      <button onClick={onExit} className="underline">Exit</button>
    </div>
  )
}

function TabPane({
  tabs, activeId, onSelect, onCreate, onRename, onDelete, readOnly,
}: {
  tabs: Tab[]; activeId: string; onSelect: (id: string) => void
  onCreate: (name: string) => void; onRename: (id: string, name: string) => void
  onDelete: (id: string) => void; readOnly?: boolean
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
  tab, active, onSelect, onRename, onDelete, readOnly,
}: {
  tab: Tab; active: boolean; onSelect: () => void
  onRename: (name: string) => void; onDelete: () => void; readOnly?: boolean
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
      {tab.id !== ROOT_TAB_ID && !readOnly && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button onClick={(e) => e.stopPropagation()} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white text-[#5F6368]" aria-label="Tab menu">
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

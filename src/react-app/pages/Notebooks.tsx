import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Folder, GraduationCap, MoreVertical, Users } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import AppShell, { Avatar } from '../components/AppShell'
import { getClasses } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { ClassNotebook } from '../lib/types'

export default function Notebooks() {
  const { user } = useAuth()
  const { data: classes, isLoading, error } = useQuery({
    queryKey: ['classes'],
    queryFn: getClasses,
  })

  const topBar = (
    <div className="flex items-center justify-between px-6 h-16">
      <div>
        <h1 className="text-xl font-medium">Notebooks</h1>
        <p className="text-xs text-[#5F6368]">All your classes, one tap away.</p>
      </div>
      <div className="flex items-center gap-3">
        <Avatar name={user?.name ?? ''} picture={user?.picture} size={36} />
      </div>
    </div>
  )

  return (
    <AppShell topBar={topBar}>
      <div className="px-6 py-6 max-w-7xl mx-auto">
        <div className="bg-white rounded-xl border border-[#E8EAED] p-6 mb-6">
          <h2 className="text-lg font-medium">Welcome back, {user?.name?.split(' ')[0] ?? 'there'}</h2>
          <p className="text-sm text-[#5F6368] mt-1">
            Open a notebook — your notes are saved straight to your class's Drive folder.
          </p>
        </div>

        {isLoading && <TileSkeletonGrid />}
        {error && <ErrorState error={error as Error} />}
        {classes && classes.length === 0 && <EmptyState />}
        {classes && classes.length > 0 && (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {classes.map((c) => <NotebookTile key={c.courseId} cls={c} />)}
          </div>
        )}
      </div>
    </AppShell>
  )
}

function NotebookTile({ cls }: { cls: ClassNotebook }) {
  const navigate = useNavigate()
  return (
    <div
      className="group bg-white rounded-xl border border-[#E8EAED] overflow-hidden cursor-pointer
                 hover:shadow-elevation-2 transition-shadow"
      onClick={() => navigate(`/notebooks/${cls.courseId}`)}
    >
      <div
        className="h-24 relative"
        style={{
          background: `linear-gradient(135deg, ${cls.accentColor}, ${cls.accentColor}99)`,
        }}
      >
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: cls.accentColor }} />
        {cls.role === 'teacher' && (
          <span className="absolute top-2 right-2 bg-white/90 text-[#202124] text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wide">
            Teacher
          </span>
        )}
      </div>
      <div className="p-4">
        <div className="font-medium text-base truncate" title={cls.name}>{cls.name}</div>
        {cls.subtitle && <div className="text-xs text-[#5F6368] truncate mt-0.5">{cls.subtitle}</div>}
      </div>
      <div className="flex items-center justify-end gap-1 px-2 pb-2 border-t border-[#F1F3F4] pt-2">
        <IconBtn label="Open notebook" onClick={(e) => { e.stopPropagation(); navigate(`/notebooks/${cls.courseId}`) }}>
          <BookOpen className="w-4 h-4" />
        </IconBtn>
        <IconBtn
          label="Open in Drive"
          onClick={(e) => { e.stopPropagation(); window.open(`https://drive.google.com/drive/folders/${cls.classFolderId}`, '_blank') }}
        >
          <Folder className="w-4 h-4" />
        </IconBtn>
        <IconBtn
          label="Open in Classroom"
          onClick={(e) => { e.stopPropagation(); window.open(`https://classroom.google.com/c/${cls.courseId}`, '_blank') }}
        >
          <GraduationCap className="w-4 h-4" />
        </IconBtn>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="p-2 rounded-full text-[#5F6368] hover:bg-[#F1F3F4]"
              aria-label="More"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="min-w-[180px] bg-white rounded-lg shadow-elevation-3 border border-[#E8EAED] py-1 text-sm"
              onClick={(e) => e.stopPropagation()}
            >
              {cls.role === 'teacher' && (
                <DropdownMenu.Item
                  className="px-3 py-2 outline-none data-[highlighted]:bg-[#F1F3F4] flex items-center gap-2 cursor-pointer"
                  onSelect={() => navigate(`/notebooks/${cls.courseId}/students`)}
                >
                  <Users className="w-4 h-4" /> View students
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Item className="px-3 py-2 outline-none data-[highlighted]:bg-[#F1F3F4] cursor-pointer">
                Archive
              </DropdownMenu.Item>
              <DropdownMenu.Item className="px-3 py-2 outline-none data-[highlighted]:bg-[#F1F3F4] cursor-pointer">
                Rename label
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  )
}

function IconBtn({ label, children, onClick }: { label: string; children: React.ReactNode; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="p-2 rounded-full text-[#5F6368] hover:bg-[#F1F3F4]"
    >
      {children}
    </button>
  )
}

function TileSkeletonGrid() {
  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-[#E8EAED] overflow-hidden">
          <div className="h-24 bg-[#F1F3F4] animate-pulse" />
          <div className="p-4 space-y-2">
            <div className="h-4 w-3/4 bg-[#F1F3F4] animate-pulse rounded" />
            <div className="h-3 w-1/2 bg-[#F1F3F4] animate-pulse rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ErrorState({ error }: { error: Error }) {
  return (
    <div className="bg-white border border-[#FCE8E6] text-[#D93025] rounded-xl p-6">
      <div className="font-medium">Couldn't load your classes</div>
      <div className="text-sm mt-1 text-[#5F6368] break-all">{error.message}</div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="bg-white rounded-xl border border-[#E8EAED] p-10 text-center">
      <div className="text-lg font-medium">No active classes</div>
      <p className="text-sm text-[#5F6368] mt-1">
        Join a class in Google Classroom and refresh — it'll appear here automatically.
      </p>
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import AppShell, { Avatar } from '../components/AppShell'
import { getClass, getStudents } from '../lib/api'
import { relativeTime } from '../lib/utils'

export default function StudentRoster() {
  const { classId = '' } = useParams()
  const navigate = useNavigate()
  const { data: cls } = useQuery({ queryKey: ['class', classId], queryFn: () => getClass(classId) })
  const { data: students = [], isLoading, error } = useQuery({
    queryKey: ['students', classId],
    queryFn: () => getStudents(classId),
    enabled: Boolean(classId),
  })

  const accent = cls?.accentColor ?? '#1A73E8'

  const topBar = (
    <div className="flex flex-col">
      <div className="h-1" style={{ background: accent }} />
      <div className="flex items-center justify-between px-6 h-16">
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => navigate('/notebooks')} className="text-[#5F6368] hover:text-[#202124]">Notebooks</button>
          <span className="text-[#5F6368]">›</span>
          <button onClick={() => navigate(`/notebooks/${classId}`)} className="text-[#5F6368] hover:text-[#202124]">{cls?.name ?? '…'}</button>
          <span className="text-[#5F6368]">›</span>
          <span className="font-medium">Students</span>
        </div>
      </div>
    </div>
  )

  return (
    <AppShell topBar={topBar}>
      <div className="px-6 py-6 max-w-6xl mx-auto">
        {isLoading && <div className="text-sm text-[#5F6368]">Loading roster…</div>}
        {error && (
          <div className="bg-white border border-[#FCE8E6] text-[#D93025] rounded-xl p-6">
            <div className="font-medium">Couldn't load students</div>
            <div className="text-sm mt-1 text-[#5F6368] break-all">{(error as Error).message}</div>
          </div>
        )}
        {students.length === 0 && !isLoading && !error && (
          <div className="bg-white rounded-xl border border-[#E8EAED] p-10 text-center">
            <div className="font-medium">No students enrolled</div>
            <p className="text-sm text-[#5F6368] mt-1">Once students join this class, they'll appear here.</p>
          </div>
        )}
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {students.map((s) => (
            <button
              key={s.userId}
              onClick={() => navigate(`/notebooks/${classId}/students/${s.userId}`)}
              className="flex items-center gap-3 p-4 bg-white rounded-xl border border-[#E8EAED] hover:shadow-elevation-1 transition text-left"
            >
              <Avatar name={s.name} picture={s.photoUrl} size={44} />
              <div className="min-w-0">
                <div className="font-medium truncate">{s.name}</div>
                <div className="text-xs text-[#5F6368] truncate">
                  {s.lastEditedAt ? `Last edited ${relativeTime(s.lastEditedAt)}` : (s.email ?? '')}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </AppShell>
  )
}

// Real Google Classroom + Drive API client. No mock fallbacks.

import type { ClassNotebook, Page, Student, Tab } from './types'
import { accentFor } from './utils'

export const ROOT_TAB_ID = '__root__'

function token(): string {
  const raw = localStorage.getItem('notesanity:auth')
  if (!raw) throw new Error('Not signed in')
  const parsed = JSON.parse(raw)
  if (!parsed.accessToken) throw new Error('Not signed in')
  return parsed.accessToken as string
}

async function gfetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

const DRIVE = 'https://www.googleapis.com/drive/v3'
const CR = 'https://classroom.googleapis.com/v1'

const FIELDS_FILE = 'id,name,mimeType,parents,modifiedTime,appProperties,owners(emailAddress)'
const FIELDS_LIST = `files(${FIELDS_FILE}),nextPageToken`

interface DriveFile {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  modifiedTime?: string
  appProperties?: Record<string, string>
  owners?: { emailAddress?: string }[]
}

const escQ = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

async function listChildren(folderId: string, mime: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and mimeType='${mime}' and trashed=false`)
  const data = await gfetch<{ files: DriveFile[] }>(
    `${DRIVE}/files?q=${q}&fields=${encodeURIComponent(FIELDS_LIST)}&pageSize=200`,
  )
  return data.files ?? []
}

async function findClassroomRoot(): Promise<string | null> {
  const q = encodeURIComponent(
    `name='Classroom' and 'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  )
  const data = await gfetch<{ files: DriveFile[] }>(`${DRIVE}/files?q=${q}&fields=files(id,name)`)
  return data.files?.[0]?.id ?? null
}

async function findClassFolder(className: string, classroomRoot: string | null): Promise<string | null> {
  if (!classroomRoot) return null
  const q = encodeURIComponent(
    `'${classroomRoot}' in parents and name='${escQ(className)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  )
  const data = await gfetch<{ files: DriveFile[] }>(`${DRIVE}/files?q=${q}&fields=files(id,name)`)
  return data.files?.[0]?.id ?? null
}

async function getFolderProps(folderId: string): Promise<Record<string, string>> {
  const f = await gfetch<DriveFile>(`${DRIVE}/files/${folderId}?fields=id,name,appProperties`).catch(() => null)
  return f?.appProperties ?? {}
}

export async function setClassAccentColor(folderId: string, hex: string): Promise<void> {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) throw new Error('Invalid color')
  await gfetch(`${DRIVE}/files/${folderId}`, {
    method: 'PATCH',
    body: JSON.stringify({ appProperties: { cnb_accentColor: hex } }),
  })
}

// Find a specific student's auto-provisioned `My Drive › Classroom › {ClassName}` folder.
// Classroom auto-shares this folder with the teacher; we look for it by owner email + name.
async function findStudentClassFolder(
  studentEmail: string | undefined,
  className: string,
): Promise<string | null> {
  if (!studentEmail) return null
  const q = encodeURIComponent(
    `'${escQ(studentEmail)}' in owners and name='${escQ(className)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  )
  const data = await gfetch<{ files: DriveFile[] }>(
    `${DRIVE}/files?q=${q}&fields=files(id,name,owners(emailAddress))&pageSize=20`,
  )
  return data.files?.[0]?.id ?? null
}

function resolveAccent(folderProps: Record<string, string> | undefined, className: string): string {
  const saved = folderProps?.cnb_accentColor
  if (saved && /^#[0-9A-Fa-f]{6}$/.test(saved)) return saved
  return accentFor(className)
}

export async function getClasses(): Promise<ClassNotebook[]> {
  const courses = await gfetch<{ courses?: any[] }>(`${CR}/courses?courseStates=ACTIVE&pageSize=50`)
  const classroomRoot = await findClassroomRoot().catch(() => null)
  const resolved = await Promise.all((courses.courses ?? []).map(async (c) => {
    // Classroom only returns `teacherFolder` on the Course resource to teachers of that course.
    // Use that as the role signal — it's far more reliable than comparing user IDs.
    const role: 'student' | 'teacher' = c.teacherFolder?.id ? 'teacher' : 'student'
    const folderId =
      c.teacherFolder?.id || (await findClassFolder(c.name, classroomRoot).catch(() => null))
    if (!folderId) return null
    const props = await getFolderProps(folderId)
    return {
      courseId: c.id,
      classFolderId: folderId,
      name: c.name,
      subtitle: c.section ?? '',
      accentColor: resolveAccent(props, c.name),
      role,
    } as ClassNotebook
  }))
  return resolved.filter((x): x is ClassNotebook => x !== null)
}

export async function getClass(classId: string): Promise<ClassNotebook | undefined> {
  const c = await gfetch<any>(`${CR}/courses/${classId}`).catch(() => null)
  if (!c) return undefined
  const classroomRoot = await findClassroomRoot().catch(() => null)
  const role: 'student' | 'teacher' = c.teacherFolder?.id ? 'teacher' : 'student'
  const folderId =
    c.teacherFolder?.id || (await findClassFolder(c.name, classroomRoot).catch(() => null))
  if (!folderId) return undefined
  const props = await getFolderProps(folderId)
  return {
    courseId: c.id,
    classFolderId: folderId,
    name: c.name,
    subtitle: c.section ?? '',
    accentColor: resolveAccent(props, c.name),
    role,
  }
}

export class StudentFolderNotSharedError extends Error {
  constructor(public studentName: string, public className: string) {
    super(
      `Can't see ${studentName}'s "${className}" notebook yet. ` +
      `Google Classroom doesn't auto-share student class folders with teachers. ` +
      `Ask ${studentName} to open Notesanity once and visit this notebook — ` +
      `Notesanity will share their class folder with you automatically.`,
    )
    this.name = 'StudentFolderNotSharedError'
  }
}

export async function getClassForStudent(classId: string, studentId: string): Promise<ClassNotebook | undefined> {
  const [c, student] = await Promise.all([
    gfetch<any>(`${CR}/courses/${classId}`).catch(() => null),
    getStudent(classId, studentId).catch(() => null),
  ])
  if (!c) return undefined
  const folderId = await findStudentClassFolder(student?.email, c.name)
  if (!folderId) {
    throw new StudentFolderNotSharedError(student?.name ?? 'this student', c.name)
  }
  const props = await getFolderProps(folderId)
  return {
    courseId: c.id,
    classFolderId: folderId,
    name: c.name,
    subtitle: c.section ?? '',
    accentColor: resolveAccent(props, c.name),
    role: 'teacher',
  }
}

// Share the student's class folder with every teacher of the course (idempotent — Drive
// silently no-ops if a matching permission already exists for an email).
export async function shareClassFolderWithTeachers(classId: string, classFolderId: string): Promise<number> {
  const teachers = await gfetch<{ teachers?: any[] }>(`${CR}/courses/${classId}/teachers?pageSize=50`).catch(() => ({ teachers: [] }))
  const emails = (teachers.teachers ?? [])
    .map((t) => t?.profile?.emailAddress)
    .filter((e: any): e is string => typeof e === 'string' && e.includes('@'))
  let shared = 0
  await Promise.all(
    emails.map(async (email) => {
      try {
        await gfetch(
          `${DRIVE}/files/${classFolderId}/permissions?sendNotificationEmail=false&supportsAllDrives=false`,
          {
            method: 'POST',
            body: JSON.stringify({ role: 'reader', type: 'user', emailAddress: email }),
          },
        )
        shared++
      } catch {
        // Already shared, or no permission to share — ignore.
      }
    }),
  )
  return shared
}

interface GetTabsOpts { withCounts?: boolean; classFolderId?: string }

export async function getTabs(classId: string, opts: GetTabsOpts = {}): Promise<Tab[]> {
  let folderId = opts.classFolderId
  if (!folderId) {
    const cls = await getClass(classId)
    if (!cls) return []
    folderId = cls.classFolderId
  }
  const folders = await listChildren(folderId, 'application/vnd.google-apps.folder')
  const tabs: Tab[] = folders.map((f, i) => ({
    id: f.id,
    name: f.name,
    order: Number(f.appProperties?.cnb_order ?? i + 1),
  }))
  tabs.sort((a, b) => a.order - b.order)
  const all: Tab[] = [{ id: ROOT_TAB_ID, name: 'Root', order: 0 }, ...tabs]

  if (opts.withCounts) {
    const folderIds = [folderId, ...tabs.map((t) => t.id)]
    const clauses = folderIds.map((id) => `'${id}' in parents`).join(' or ')
    const q = encodeURIComponent(
      `(${clauses}) and mimeType='application/vnd.google-apps.document' and trashed=false`,
    )
    const data = await gfetch<{ files: DriveFile[] }>(
      `${DRIVE}/files?q=${q}&fields=files(id,parents)&pageSize=1000`,
    ).catch(() => ({ files: [] as DriveFile[] }))
    const counts = new Map<string, number>()
    for (const f of data.files ?? []) {
      for (const p of f.parents ?? []) counts.set(p, (counts.get(p) ?? 0) + 1)
    }
    for (const t of all) {
      const lookup = t.id === ROOT_TAB_ID ? folderId : t.id
      t.pageCount = counts.get(lookup) ?? 0
    }
  }
  return all
}

interface GetPagesOpts { classFolderId?: string }

export async function getPages(classId: string, tabId: string, opts: GetPagesOpts = {}): Promise<Page[]> {
  let classFolderId = opts.classFolderId
  if (!classFolderId) {
    const cls = await getClass(classId)
    if (!cls) return []
    classFolderId = cls.classFolderId
  }
  const folderId = tabId === ROOT_TAB_ID ? classFolderId : tabId
  const docs = await listChildren(folderId, 'application/vnd.google-apps.document')
  const pages: Page[] = docs.map((d, i) => ({
    id: d.id,
    title: d.name,
    tabId,
    order: Number(d.appProperties?.cnb_order ?? i),
    modifiedTime: d.modifiedTime ?? new Date().toISOString(),
  }))
  pages.sort((a, b) => a.order - b.order)
  return pages
}

export async function createPage(classId: string, tabId: string, title?: string): Promise<Page> {
  const cls = await getClass(classId)
  if (!cls) throw new Error('Class not found')
  const folderId = tabId === ROOT_TAB_ID ? cls.classFolderId : tabId
  const name = title ?? `Untitled page · ${new Date().toLocaleString()}`
  const file = await gfetch<DriveFile>(`${DRIVE}/files?fields=${encodeURIComponent(FIELDS_FILE)}`, {
    method: 'POST',
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.document',
      parents: [folderId],
      appProperties: { cnb_kind: 'page', cnb_createdInApp: 'true' },
    }),
  })
  return {
    id: file.id,
    title: file.name,
    tabId,
    order: Date.now(),
    modifiedTime: file.modifiedTime ?? new Date().toISOString(),
  }
}

export async function createTab(classId: string, name: string): Promise<Tab> {
  const cls = await getClass(classId)
  if (!cls) throw new Error('Class not found')
  const file = await gfetch<DriveFile>(`${DRIVE}/files?fields=${encodeURIComponent(FIELDS_FILE)}`, {
    method: 'POST',
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [cls.classFolderId],
      appProperties: { cnb_kind: 'tab', cnb_createdInApp: 'true' },
    }),
  })
  return { id: file.id, name: file.name, order: Date.now() }
}

export async function renamePage(_classId: string, pageId: string, title: string) {
  await gfetch(`${DRIVE}/files/${pageId}`, { method: 'PATCH', body: JSON.stringify({ name: title }) })
}

export async function renameTab(_classId: string, tabId: string, name: string) {
  if (tabId === ROOT_TAB_ID) return
  await gfetch(`${DRIVE}/files/${tabId}`, { method: 'PATCH', body: JSON.stringify({ name }) })
}

export async function deletePage(_classId: string, pageId: string) {
  await gfetch(`${DRIVE}/files/${pageId}`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) })
}

export async function deleteTab(_classId: string, tabId: string) {
  if (tabId === ROOT_TAB_ID) return
  await gfetch(`${DRIVE}/files/${tabId}`, { method: 'PATCH', body: JSON.stringify({ trashed: true }) })
}

export async function movePage(classId: string, pageId: string, toTabId: string) {
  const cls = await getClass(classId)
  if (!cls) throw new Error('Class not found')
  const dest = toTabId === ROOT_TAB_ID ? cls.classFolderId : toTabId
  const current = await gfetch<DriveFile>(`${DRIVE}/files/${pageId}?fields=parents`)
  const removeParents = (current.parents ?? []).join(',')
  await gfetch(
    `${DRIVE}/files/${pageId}?addParents=${dest}&removeParents=${encodeURIComponent(removeParents)}`,
    { method: 'PATCH', body: JSON.stringify({}) },
  )
}

export async function getStudents(classId: string): Promise<Student[]> {
  const data = await gfetch<{ students?: any[] }>(`${CR}/courses/${classId}/students?pageSize=200`)
  return (data.students ?? []).map((s) => ({
    userId: s.userId,
    name: s.profile?.name?.fullName ?? 'Student',
    email: s.profile?.emailAddress,
    photoUrl: s.profile?.photoUrl,
  }))
}

export async function getStudent(classId: string, studentId: string): Promise<Student | undefined> {
  const s = await gfetch<any>(`${CR}/courses/${classId}/students/${studentId}`).catch(() => null)
  if (!s) return undefined
  return {
    userId: s.userId,
    name: s.profile?.name?.fullName ?? 'Student',
    email: s.profile?.emailAddress,
    photoUrl: s.profile?.photoUrl,
  }
}

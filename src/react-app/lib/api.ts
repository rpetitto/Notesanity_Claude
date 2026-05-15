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

const FIELDS_FILE = 'id,name,mimeType,parents,modifiedTime,appProperties'
const FIELDS_LIST = `files(${FIELDS_FILE}),nextPageToken`

interface DriveFile {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  modifiedTime?: string
  appProperties?: Record<string, string>
}

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
    `'${classroomRoot}' in parents and name='${className.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  )
  const data = await gfetch<{ files: DriveFile[] }>(`${DRIVE}/files?q=${q}&fields=files(id,name)`)
  return data.files?.[0]?.id ?? null
}

export async function getClasses(): Promise<ClassNotebook[]> {
  const courses = await gfetch<{ courses?: any[] }>(`${CR}/courses?courseStates=ACTIVE&pageSize=50`)
  const me = await gfetch<{ id: string }>(`${CR}/userProfiles/me`).catch(() => ({ id: '' }))
  const classroomRoot = await findClassroomRoot().catch(() => null)
  const out: ClassNotebook[] = []
  for (const c of courses.courses ?? []) {
    const role: 'student' | 'teacher' = me.id && c.ownerId === me.id ? 'teacher' : 'student'
    const folderId =
      c.teacherFolder?.id || (await findClassFolder(c.name, classroomRoot).catch(() => null))
    if (!folderId) continue
    out.push({
      courseId: c.id,
      classFolderId: folderId,
      name: c.name,
      subtitle: c.section ?? '',
      accentColor: accentFor(c.name),
      role,
    })
  }
  return out
}

export async function getClass(classId: string): Promise<ClassNotebook | undefined> {
  const all = await getClasses()
  return all.find((c) => c.courseId === classId)
}

export async function getTabs(classId: string): Promise<Tab[]> {
  const cls = await getClass(classId)
  if (!cls) return []
  const folders = await listChildren(cls.classFolderId, 'application/vnd.google-apps.folder')
  const tabs: Tab[] = folders.map((f, i) => ({
    id: f.id,
    name: f.name,
    order: Number(f.appProperties?.cnb_order ?? i + 1),
  }))
  tabs.sort((a, b) => a.order - b.order)
  return [{ id: ROOT_TAB_ID, name: 'Root', order: 0 }, ...tabs]
}

export async function getPages(classId: string, tabId: string): Promise<Page[]> {
  const cls = await getClass(classId)
  if (!cls) return []
  const folderId = tabId === ROOT_TAB_ID ? cls.classFolderId : tabId
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

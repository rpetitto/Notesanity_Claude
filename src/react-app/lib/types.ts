export type Role = 'student' | 'teacher'

export interface UserProfile {
  sub: string
  email: string
  name: string
  picture?: string
}

export interface ClassNotebook {
  courseId: string
  classFolderId: string
  name: string
  subtitle?: string
  accentColor: string
  bannerImageUrl?: string
  role: Role
}

export interface Tab {
  id: string // Drive folder id; `__root__` for class-folder-as-root
  name: string
  order: number
  pageCount?: number
}

export interface Page {
  id: string // Drive Doc id
  title: string
  tabId: string
  order: number
  modifiedTime: string
}

export interface Student {
  userId: string
  name: string
  email?: string
  photoUrl?: string
  lastEditedAt?: string
}

export interface Prefs {
  themeMode: 'system' | 'light' | 'dark'
  matchClassroomTheme: boolean
  rolloverAtTabEnd: boolean
  lastOpenedClassId?: string
  lastOpenedPageByClass: Record<string, string>
}

export const DEFAULT_PREFS: Prefs = {
  themeMode: 'system',
  matchClassroomTheme: true,
  rolloverAtTabEnd: false,
  lastOpenedPageByClass: {},
}

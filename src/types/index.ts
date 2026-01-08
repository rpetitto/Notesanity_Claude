// User and Authentication Types
export interface User {
  id: string
  email: string
  full_name: string
  role?: 'admin' | 'user'
}

// Core Entity Types
export interface Domain {
  id: string
  googleCustomerId?: string
  name: string
  status: 'active' | 'suspended' | 'pending'
  settings?: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Portfolio {
  id: string
  domainId?: string
  ownerUserId: string
  visibility: 'DOMAIN_ONLY' | 'PRIVATE'
  name?: string
  created_at: string
  updated_at: string
}

export interface Course {
  id: string
  domainId?: string
  googleClassroomCourseId?: string
  name: string
  section?: string
  description?: string
  status: 'active' | 'archived' | 'provisioned'
  ownerId?: string
  classroomFolderId?: string
  enrollmentCode?: string
  lastSyncAt?: string
  created_at: string
  updated_at: string
}

export interface Binder {
  id: string
  portfolioId?: string
  courseId: string
  ownerUserId: string
  name?: string
  lastDriveSyncAt?: string
  lastDriveSyncError?: string
  status: 'active' | 'archived'
  created_at: string
  updated_at: string
}

export interface Section {
  id: string
  binderId: string
  title: string
  orderIndex: number
  isSystem: boolean
  systemKey?: 'GENERAL' | 'ASSIGNMENTS'
  published: boolean
  origin: 'APP' | 'DRIVE' | 'CLASSROOM'
  managedByApp: boolean
  driveFolderId?: string
  color?: string
  deletedAt?: string
  created_at: string
  updated_at: string
}

export interface Folder {
  id: string
  binderId: string
  sectionId: string
  parentFolderId?: string
  title: string
  orderIndex: number
  driveFolderId?: string
  ownerUserId?: string
  origin: 'APP' | 'DRIVE' | 'CLASSROOM'
  deletedAt?: string
  created_at: string
  updated_at: string
}

export type PageType = 'DRIVE_FILE' | 'CANVAS' | 'UPLOAD' | 'EMBED'
export type OriginType = 'TEACHER_DISTRIBUTED' | 'STUDENT_ADDED' | 'DRIVE_DISCOVERED' | 'CLASSROOM_SYNC'
export type DistributionType = 'REFERENCE' | 'TEMPLATE_COPY' | 'NONE'
export type DistributionStatus = 'private' | 'viewOnlyDistributed' | 'copyDistributed'

export interface Page {
  id: string
  binderId: string
  sectionId: string
  folderId?: string
  title: string
  orderIndex: number
  pageType: PageType
  originType: OriginType
  distributionType: DistributionType
  distributionStatus: DistributionStatus
  moveScope: 'WITHIN_SECTION_ONLY' | 'FULL'
  ownerUserId?: string
  origin: 'APP' | 'DRIVE' | 'CLASSROOM'
  managedByApp: boolean
  pageSourceId?: string
  driveFileId?: string
  driveMimeType?: string
  thumbnailUrl?: string
  canvasDocId?: string
  deletedAt?: string
  deletedByUserId?: string
  created_at: string
  updated_at: string
}

export interface CourseMembership {
  id: string
  courseId: string
  userId: string
  roleInCourse: 'STUDENT' | 'TEACHER' | 'CO_TEACHER'
  googleClassroomUserId?: string
  status: 'active' | 'invited' | 'removed'
  created_at: string
  updated_at: string
}

// Drive Integration Types
export interface DriveFolderMap {
  id: string
  ownerUserId: string
  binderId?: string
  sectionId?: string
  folderType: 'BINDER_ROOT' | 'SECTION_FOLDER'
  driveFolderId: string
  parentDriveFolderId?: string
  created_at: string
  updated_at: string
}

export interface DriveItemMap {
  id: string
  ownerUserId: string
  pageId?: string
  sectionId?: string
  itemType: 'FILE' | 'SHORTCUT'
  driveItemId: string
  targetDriveFileId?: string
  parentDriveFolderId?: string
  origin: 'APP' | 'DRIVE'
  lastSeenAt?: string
  checksum?: string
  created_at: string
  updated_at: string
}

export interface OAuthGrant {
  id: string
  userId: string
  provider: 'GOOGLE'
  accessToken: string
  refreshToken?: string
  scopes: string[]
  expiresAt?: string
  revokedAt?: string
  created_at: string
  updated_at: string
}

// Distribution Types
export interface DistributionEvent {
  id: string
  courseId: string
  teacherUserId: string
  sourcePageId?: string
  sourceDriveFileId?: string
  distributionType: 'REFERENCE' | 'TEMPLATE_COPY'
  targetSectionKey: string
  notifyStudents: boolean
  created_at: string
  updated_at: string
}

export interface DistributionInstance {
  id: string
  distributionEventId: string
  studentUserId: string
  studentPageId?: string
  studentDriveItemId?: string
  status: 'PENDING_AUTH' | 'CREATED' | 'FAILED'
  errorMessage?: string
  created_at: string
  updated_at: string
}

// Canvas Types
export interface CanvasDoc {
  id: string
  pageId: string
  currentRevision: number
  width: number
  height: number
  backgroundColor: string
  created_at: string
  updated_at: string
}

export interface CanvasRevision {
  id: string
  canvasDocId: string
  revisionNumber: number
  strokeDataJson: string
  exportedDriveFileId?: string
  exportedUrl?: string
  created_at: string
  updated_at: string
}

// Comments Types
export interface CommentThread {
  id: string
  pageId: string
  status: 'open' | 'resolved'
  positionX?: number
  positionY?: number
  created_at: string
  updated_at: string
}

export interface Comment {
  id: string
  threadId: string
  authorUserId: string
  authorName?: string
  body: string
  editedAt?: string
  created_at: string
  updated_at: string
}

// Notification Types
export type NotificationType = 'PAGE_DISTRIBUTED' | 'COMMENT_ADDED' | 'PAGE_UPDATED' | 'SYNC_COMPLETE' | 'SYNC_ERROR'

export interface Notification {
  id: string
  recipientUserId: string
  type: NotificationType
  title?: string
  message?: string
  entityType?: string
  entityId?: string
  readAt?: string
  created_at: string
  updated_at: string
}

// Analytics Types
export type MetricKey = 'ACTIVE_USERS' | 'PAGES_CREATED' | 'PAGES_VIEWED' | 'SYNC_OPERATIONS' | 'CANVAS_SAVES'
export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'DISTRIBUTE' | 'SYNC' | 'LOGIN' | 'IMPORT'

export interface UsageDaily {
  id: string
  domainId: string
  usageDate: string
  metricKey: MetricKey
  metricValue: number
  created_at: string
  updated_at: string
}

export interface AuditEvent {
  id: string
  domainId?: string
  actorUserId: string
  actorEmail?: string
  action: AuditAction
  entityType: string
  entityId?: string
  details?: Record<string, unknown>
  ipAddress?: string
  created_at: string
  updated_at: string
}

// Google Classroom Types (for import)
export interface GoogleClassroomCourse {
  id: string
  name: string
  section?: string
  descriptionHeading?: string
  description?: string
  ownerId: string
  courseState: 'ACTIVE' | 'ARCHIVED' | 'PROVISIONED' | 'DECLINED' | 'SUSPENDED'
  alternateLink: string
}

// UI State Types
export interface SyncStatus {
  isSyncing: boolean
  lastSyncAt?: string
  error?: string
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as any;
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
};

// ---------- shared types ----------

export interface Me {
  id: string;
  email: string;
  name: string;
  picture?: string | null;
  role: "teacher" | "student" | "pending";
  isAdmin: boolean;
}

export interface ClassSummary {
  id: string;
  name: string;
  section: string;
  accent_color: string;
  source: "manual" | "classroom";
  join_code?: string;
  student_count: number;
  notebook_count: number;
  my_role: "teacher" | "student";
}

export interface PageRec {
  id: string;
  seq: number;
  asset_key: string;
  source_index: number;
  width: number;
  height: number;
  label: string;
  archived?: number;
}

export interface FieldRec {
  id: string;
  page_id: string;
  /**
   * `prompt` pairs a teacher instruction (and optional image) with an answer box;
   * `image` and `audio` take a student upload inside the teacher-defined box.
   */
  type: "text" | "checkbox" | "choice" | "prompt" | "image" | "audio";
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  options: string;
  /** Teacher instruction, used by `prompt` fields. */
  prompt?: string;
  /**
   * Truthy when the teacher attached an illustration to a `prompt` field.
   * SQLite returns the `IS NOT NULL` test as 0/1, but drivers may hand back a
   * boolean, so accept either rather than forcing casts at every call site.
   */
  has_media?: number | boolean;
}

export interface LayerRec {
  page_id: string;
  kind: "student" | "teacher";
  data: string;
  rev: number;
}

export interface WorkResponse {
  notebook: { id: string; title: string; classId: string };
  instanceId: string;
  pages: PageRec[];
  fields: FieldRec[];
  layers: LayerRec[];
  values: { field_id: string; value: string }[];
  student: { id: string; name: string; email: string; picture?: string | null };
  isTeacher: boolean;
}

export interface AssignmentSummary {
  id: string;
  title: string;
  notebookId: string;
  notebookTitle: string;
  pageCount: number;
  releaseAt: string | null;
  dueAt: string | null;
  grading: "none" | "complete" | "points" | "letter";
  pointsMax: number;
  status: "draft" | "active";
  submitted?: number;
  returned?: number;
  total?: number;
  myStatus?: string;
  complete?: number;
  grade?: { points: number | null; letter: string | null; complete: number | null; feedback?: string } | null;
}

export const assetUrl = (notebookId: string, key?: string) =>
  `/api/notebooks/${notebookId}/asset${key ? `?key=${encodeURIComponent(key)}` : ""}`;

/**
 * Browser-side Google integration.
 *
 * Two things need Google beyond sign-in: importing a Classroom roster, and
 * converting Word/PowerPoint uploads to PDF. Both run entirely in the teacher's
 * browser with their own OAuth token via incremental consent, so students are
 * never asked for Drive or Classroom scopes and the server holds no Google
 * credentials.
 */

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";
export const hasGoogleClientId = Boolean(CLIENT_ID);

export const CLASSROOM_SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.profile.emails",
].join(" ");

// drive.file is enough: we only touch files this app itself creates.
export const DRIVE_SCOPES = "https://www.googleapis.com/auth/drive.file";

declare global {
  interface Window {
    google?: any;
  }
}

let gisPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-gis="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Google script")));
      return;
    }
    const el = document.createElement("script");
    el.src = "https://accounts.google.com/gsi/client";
    el.async = true;
    el.defer = true;
    el.dataset.gis = "1";
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("Failed to load Google script"));
    document.head.appendChild(el);
  });
  return gisPromise;
}

const tokens = new Map<string, { token: string; expiresAt: number }>();

/** Request (or reuse) an access token for a scope set. Prompts only when needed. */
export async function getToken(scope: string): Promise<string> {
  if (!CLIENT_ID) {
    throw new Error("Google integration isn't configured — set VITE_GOOGLE_CLIENT_ID and redeploy.");
  }
  const cached = tokens.get(scope);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  await loadGis();
  return new Promise<string>((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope,
      callback: (resp: any) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        tokens.set(scope, { token: resp.access_token, expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000 });
        resolve(resp.access_token);
      },
      error_callback: (err: any) => reject(new Error(err?.message ?? "Google authorization was cancelled")),
    });
    client.requestAccessToken({ prompt: cached ? "" : "consent" });
  });
}

async function gapi<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google API error ${res.status}: ${text.slice(0, 180)}`);
  }
  return res.json() as Promise<T>;
}

export interface ClassroomCourse {
  id: string;
  name: string;
  section?: string;
  courseState?: string;
}

export async function listCourses(): Promise<ClassroomCourse[]> {
  const token = await getToken(CLASSROOM_SCOPES);
  const data = await gapi<{ courses?: ClassroomCourse[] }>(
    "https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&teacherId=me&pageSize=50",
    token,
  );
  return data.courses ?? [];
}

export interface ClassroomStudent {
  email: string;
  name: string;
  photoUrl?: string;
}

export async function listStudents(courseId: string): Promise<ClassroomStudent[]> {
  const token = await getToken(CLASSROOM_SCOPES);
  const out: ClassroomStudent[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`https://classroom.googleapis.com/v1/courses/${courseId}/students`);
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const data = await gapi<{ students?: any[]; nextPageToken?: string }>(url.toString(), token);
    for (const s of data.students ?? []) {
      const email = s.profile?.emailAddress;
      if (email) {
        out.push({
          email,
          name: s.profile?.name?.fullName ?? email,
          photoUrl: s.profile?.photoUrl ? `https:${s.profile.photoUrl}`.replace("https:https:", "https:") : undefined,
        });
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

const CONVERTIBLE: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "application/vnd.google-apps.document",
  "application/msword": "application/vnd.google-apps.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "application/vnd.google-apps.presentation",
  "application/vnd.ms-powerpoint": "application/vnd.google-apps.presentation",
};

export function needsConversion(file: File): boolean {
  if (file.type === "application/pdf") return false;
  if (CONVERTIBLE[file.type]) return true;
  return /\.(docx?|pptx?)$/i.test(file.name);
}

function targetMimeFor(file: File): string {
  if (CONVERTIBLE[file.type]) return CONVERTIBLE[file.type];
  return /\.pptx?$/i.test(file.name)
    ? "application/vnd.google-apps.presentation"
    : "application/vnd.google-apps.document";
}

/**
 * Convert a Word/PowerPoint file to PDF by round-tripping it through the
 * teacher's own Drive: upload with conversion, export as PDF, then delete the
 * temporary Drive file so nothing is left behind.
 */
export async function convertToPdf(file: File, onProgress?: (msg: string) => void): Promise<Blob> {
  const token = await getToken(DRIVE_SCOPES);
  onProgress?.("Uploading to Google Drive…");

  const metadata = { name: `notesanity-import-${file.name}`, mimeType: targetMimeFor(file) };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", file);

  const uploaded = await gapi<{ id: string }>(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    token,
    { method: "POST", body: form },
  );

  try {
    onProgress?.("Converting to PDF…");
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${uploaded.id}/export?mimeType=application/pdf`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        res.status === 403 && text.includes("exportSizeLimitExceeded")
          ? "That document is too large for Google to export (10MB limit). Export it to PDF yourself and upload the PDF."
          : `Conversion failed (${res.status})`,
      );
    }
    return await res.blob();
  } finally {
    // Best-effort cleanup; a leftover temp file shouldn't fail the import.
    fetch(`https://www.googleapis.com/drive/v3/files/${uploaded.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
}

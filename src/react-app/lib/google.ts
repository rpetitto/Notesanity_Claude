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

/**
 * Posting work and sending grades back.
 *
 * One extra scope does both: `coursework.students` covers creating coursework
 * and patching student submissions. It is asked for separately from the
 * read-only set above so that a teacher who only ever imports a roster is never
 * prompted for write access to their courses — incremental consent, which is
 * also why the two are different cache keys in `getToken`.
 */
export const COURSEWORK_SCOPES = [
  CLASSROOM_SCOPES,
  "https://www.googleapis.com/auth/classroom.coursework.students",
].join(" ");

// drive.file is enough: we only touch files this app itself creates.
export const DRIVE_SCOPES = "https://www.googleapis.com/auth/drive.file";

declare global {
  interface Window {
    google?: any;
    gapi?: any;
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
      error_callback: (err: any) => reject(new Error(err?.message ?? "Google authorization was canceled")),
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
  /** Classroom's own description and room, carried across so they aren't retyped. */
  description?: string;
  descriptionHeading?: string;
  room?: string;
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
  /** Classroom's own id for this person — what a submission is keyed by. */
  userId?: string;
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
          userId: s.userId,
          name: s.profile?.name?.fullName ?? email,
          photoUrl: s.profile?.photoUrl ? `https:${s.profile.photoUrl}`.replace("https:https:", "https:") : undefined,
        });
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

/* ---------- posting work to Classroom, and sending the grade back ---------- */

const CLASSROOM = "https://classroom.googleapis.com/v1";

export interface CourseworkDraft {
  title: string;
  description?: string;
  /** Where the link material points — the Notesanity assignment. */
  link: string;
  /** ISO timestamp, or null for no due date. */
  dueAt?: string | null;
  /** ISO timestamp in the future to schedule the post, or null to publish now. */
  scheduledAt?: string | null;
  /** Omit or 0 for coursework Classroom won't grade. */
  maxPoints?: number | null;
}

export interface PostedCoursework {
  id: string;
  link: string;
  /** False when Classroom holds it as a scheduled draft rather than publishing now. */
  published: boolean;
}

/**
 * Post an assignment to the Classroom course this class came from.
 *
 * The material is a plain link, not a Drive copy per student: the work happens
 * in Notesanity, and `/assignments/:id` already routes by role, so the same URL
 * takes a student to their workspace and the teacher to marking. A Drive
 * attachment would fork the work into two places that then disagree.
 */
export async function createCoursework(courseId: string, draft: CourseworkDraft): Promise<PostedCoursework> {
  const token = await getToken(COURSEWORK_SCOPES);
  const body = courseworkBody(draft);

  const created = await gapi<{ id: string; alternateLink?: string }>(
    `${CLASSROOM}/courses/${courseId}/courseWork`,
    token,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  return {
    id: created.id,
    link: created.alternateLink ?? `https://classroom.google.com/c/${courseId}`,
    published: body.state === "PUBLISHED",
  };
}

/**
 * The request body, split out because the date handling is the part worth
 * being able to check without a Google account attached.
 */
export function courseworkBody(draft: CourseworkDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    // Classroom truncates past 3,000 characters and rejects past its own limit;
    // trimming here means a long notebook title fails visibly rather than at Google.
    title: draft.title.slice(0, 300),
    workType: "ASSIGNMENT",
    state: "PUBLISHED",
    materials: [{ link: { url: draft.link } }],
  };
  if (draft.description?.trim()) body.description = draft.description.trim().slice(0, 3000);
  if (draft.maxPoints && draft.maxPoints > 0) body.maxPoints = draft.maxPoints;

  // Classroom wants the date and the time of day separately, both in UTC —
  // not the ISO timestamp everything else in this app passes around.
  if (draft.dueAt) {
    const d = new Date(draft.dueAt);
    if (!Number.isNaN(d.getTime())) {
      body.dueDate = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
      body.dueTime = { hours: d.getUTCHours(), minutes: d.getUTCMinutes() };
    }
  }

  // A release date becomes a scheduled draft, which is Classroom's own way of
  // saying the same thing. Publishing now and hoping nobody looks early isn't.
  const scheduled = draft.scheduledAt ? new Date(draft.scheduledAt) : null;
  if (scheduled && !Number.isNaN(scheduled.getTime()) && scheduled.getTime() > Date.now()) {
    body.state = "DRAFT";
    body.scheduledTime = scheduled.toISOString();
  }

  return body;
}

export interface ClassroomGrade {
  /** The Notesanity student's email — the only thing both systems agree on. */
  email: string;
  points: number;
}

export interface GradePushResult {
  /** Grades Classroom accepted and returned to the student. */
  returned: number;
  /**
   * Grades Classroom accepted but would not release, because the student never
   * pressed Turn in there. The teacher sees them; the student doesn't until the
   * teacher returns them in Classroom.
   */
  held: number;
  /** Emails that aren't in the Classroom course at all. */
  missing: string[];
}

/** Run `work` over `items` a few at a time — kind to Classroom's rate limits. */
async function pool<T>(items: T[], width: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  });
  await Promise.all(runners);
}

/**
 * Send grades to a Classroom assignment this app posted.
 *
 * Google only permits modifying coursework the same app created, so this works
 * for assignments posted from here and for nothing else — which is why the
 * coursework id is stored rather than asked for.
 *
 * The grade is written twice on purpose: `draftGrade` is what the teacher sees
 * in the Classroom gradebook, `assignedGrade` is what the student sees once the
 * submission is returned. Setting only one leaves half the picture.
 */
export async function pushGrades(
  courseId: string,
  courseWorkId: string,
  grades: ClassroomGrade[],
): Promise<GradePushResult> {
  const token = await getToken(COURSEWORK_SCOPES);

  const roster = await listStudents(courseId);
  const idByEmail = new Map<string, string>();
  for (const s of roster) if (s.userId) idByEmail.set(s.email.toLowerCase(), s.userId);

  const submissions: { id: string; userId: string }[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${CLASSROOM}/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions`);
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const data = await gapi<{ studentSubmissions?: any[]; nextPageToken?: string }>(url.toString(), token);
    for (const sub of data.studentSubmissions ?? []) {
      if (sub.id && sub.userId) submissions.push({ id: sub.id, userId: sub.userId });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  const subByUser = new Map(submissions.map((s) => [s.userId, s.id]));

  const result: GradePushResult = { returned: 0, held: 0, missing: [] };
  const targets: { submissionId: string; points: number }[] = [];
  for (const g of grades) {
    const userId = idByEmail.get(g.email.toLowerCase());
    const submissionId = userId ? subByUser.get(userId) : undefined;
    if (!submissionId) result.missing.push(g.email);
    else targets.push({ submissionId, points: g.points });
  }

  await pool(targets, 5, async ({ submissionId, points }) => {
    const base = `${CLASSROOM}/courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions/${submissionId}`;
    await gapi(`${base}?updateMask=draftGrade,assignedGrade`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftGrade: points, assignedGrade: points }),
    });
    // Returning is what makes the grade visible, and Classroom refuses it for a
    // submission the student never turned in there. That is an ordinary outcome
    // when the work was handed in through Notesanity, so it is counted, not thrown.
    const res = await fetch(`${base}:return`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (res.ok) result.returned++;
    else if (res.status === 400 || res.status === 403) result.held++;
    else {
      const text = await res.text().catch(() => "");
      throw new Error(`Google API error ${res.status}: ${text.slice(0, 180)}`);
    }
  });

  return result;
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

/* ---------- picking an existing file out of Drive ---------- */

/**
 * The Picker needs the Cloud project number, which is the part of the client id
 * before the first dash. Deriving it keeps one thing to configure rather than two.
 */
const APP_ID = CLIENT_ID.split("-")[0] ?? "";

/**
 * Google documents an API key as one of the things `PickerBuilder` takes, but
 * the Picker is widely used without one and the failure, if it matters, is at
 * open time rather than at build time. So the button is offered whenever Google
 * is configured at all: hiding it would mean a school that has everything else
 * set up never discovers the feature exists, and a clear message beats a
 * missing button.
 */
const API_KEY = (import.meta.env.VITE_GOOGLE_API_KEY as string | undefined) ?? "";
export const hasDrivePicker = Boolean(CLIENT_ID);

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

/** Types a notebook can be built from. */
const PICKABLE = [
  "application/pdf",
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.presentation",
].join(",");

let pickerPromise: Promise<void> | null = null;

function loadPicker(): Promise<void> {
  if (window.google?.picker) return Promise.resolve();
  if (pickerPromise) return pickerPromise;
  pickerPromise = new Promise<void>((resolve, reject) => {
    const done = () => window.gapi.load("picker", { callback: () => resolve(), onerror: () => reject(new Error("Couldn't load the Google Picker")) });
    if (window.gapi?.load) return done();
    const el = document.createElement("script");
    el.src = "https://apis.google.com/js/api.js";
    el.async = true;
    el.defer = true;
    el.onload = done;
    el.onerror = () => reject(new Error("Couldn't load the Google Picker"));
    document.head.appendChild(el);
  });
  return pickerPromise;
}

/**
 * Show the teacher their own Drive and return what they chose.
 *
 * `drive.file` stays the only scope asked for: picking a file through the
 * Picker grants this app access to that one file, which is the whole point of
 * using it rather than asking to read someone's entire Drive.
 *
 * Resolves to null when the picker is closed without choosing.
 */
export async function pickDriveFile(): Promise<DriveFile | null> {
  const token = await getToken(DRIVE_SCOPES);
  await loadPicker();
  const picker = window.google.picker;

  return new Promise<DriveFile | null>((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS)
      .setMimeTypes(PICKABLE)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false);

    const builder = new picker.PickerBuilder()
      .setAppId(APP_ID)
      .setOAuthToken(token)
      .addView(view)
      .addView(new picker.DocsUploadView())
      .setTitle("Choose a document")
      .setCallback((data: any) => {
        if (data.action === picker.Action.PICKED) {
          const doc = data.docs?.[0];
          resolve(doc ? { id: doc.id, name: doc.name, mimeType: doc.mimeType } : null);
        } else if (data.action === picker.Action.CANCEL) {
          resolve(null);
        }
      });
    if (API_KEY) builder.setDeveloperKey(API_KEY);
    builder.build().setVisible(true);
  });
}

/**
 * Get a picked Drive file as a PDF.
 *
 * A Doc or Slides deck is exported; a PDF is downloaded as it stands. Either
 * way what comes back is a PDF, which is the only thing the rest of the import
 * knows how to read.
 */
export async function driveFileAsPdf(file: DriveFile): Promise<Blob> {
  const token = await getToken(DRIVE_SCOPES);
  const isNative = file.mimeType.startsWith("application/vnd.google-apps.");
  const url = isNative
    ? `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=application/pdf`
    : `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      res.status === 403 && text.includes("exportSizeLimitExceeded")
        ? "That document is too large for Google to export (10MB limit). Export it to PDF yourself and upload the PDF."
        : `Couldn't fetch that file from Drive (${res.status})`,
    );
  }
  return await res.blob();
}

/**
 * Put a finished PDF in the person's own Drive.
 *
 * `drive.file` is the scope we already hold, and it is exactly the right one:
 * it grants access to files this app creates and nothing else, so saying yes
 * to this doesn't hand Notesanity the rest of someone's Drive. The trade is
 * that we can't file it into a folder we didn't make, so it lands in My Drive
 * — which is where a person looks for something they just saved anyway.
 */
export async function uploadPdfToDrive(blob: Blob, filename: string): Promise<{ id: string; link: string }> {
  const token = await getToken(DRIVE_SCOPES);
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify({ name: filename, mimeType: "application/pdf" })], { type: "application/json" }),
  );
  form.append("file", blob);

  const file = await gapi<{ id: string; webViewLink?: string }>(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    token,
    { method: "POST", body: form },
  );
  return { id: file.id, link: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view` };
}

/* ---------- signing in ---------- */

/**
 * Ask Google who this is, and hand the proof to our own server.
 *
 * This returns an ID token — a JWT Google has signed — rather than running an
 * OAuth redirect. The server verifies that signature and issues its own
 * session, which means no client secret exists anywhere in the system and the
 * user never leaves the page.
 */
export async function requestGoogleIdToken(): Promise<string> {
  if (!CLIENT_ID) throw new Error("Google sign-in isn't configured for this deployment.");
  await loadGis();

  return new Promise<string>((resolve, reject) => {
    window.google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: (resp: { credential?: string }) => {
        if (resp?.credential) resolve(resp.credential);
        else reject(new Error("Google didn't return a sign-in."));
      },
      // The address is what identifies the account here, so the picker is
      // always shown rather than silently reusing a previous choice — a shared
      // classroom machine must not sign the next person in as the last one.
      auto_select: false,
      cancel_on_tap_outside: true,
      // Required rather than optional now: Chrome has moved One Tap onto FedCM,
      // and without opting in the prompt is refused by the browser rather than
      // shown — which arrives here looking exactly like a person dismissing it.
      use_fedcm_for_prompt: true,
    });

    window.google.accounts.id.prompt((n: any) => {
      if (n?.isNotDisplayed?.()) reject(new Error(notDisplayedMessage(n.getNotDisplayedReason?.())));
      else if (n?.isSkippedMoment?.()) reject(new Error(skippedMessage(n.getSkippedReason?.())));
    });
  });
}

/**
 * Why the prompt never appeared, in words that suggest what to do about it.
 *
 * This used to be one sentence for every outcome — "Google sign-in was
 * dismissed. Try again." — which was wrong most of the time it was shown.
 * `isNotDisplayed` means the prompt was never put on screen at all: there was
 * nothing to dismiss, and trying again does the same nothing. The reason
 * Google hands back is the only way to tell a browser policy from a signed-out
 * account from a misconfigured origin, so it decides the advice.
 */
function notDisplayedMessage(reason?: string): string {
  switch (reason) {
    case "opt_out_or_no_session":
      return "You're not signed in to Google in this browser. Sign in to your Google account first, or use a sign-in link instead.";
    case "suppressed_by_user":
      return "Google has stopped offering its sign-in prompt on this site because it was closed a few times. Use a sign-in link, or clear this site's cookies to reset it.";
    case "browser_not_supported":
      return "This browser doesn't support Google's sign-in prompt. Use a sign-in link or a password instead.";
    case "secure_http_required":
      return "Google sign-in needs a secure (https) connection.";
    case "unregistered_origin":
    case "invalid_client":
    case "missing_client_id":
      return "Google sign-in isn't set up correctly for this site. Use a sign-in link — and let us know, because this one is ours to fix.";
    default:
      return "Google's sign-in prompt couldn't open — a browser setting or extension usually blocks it. Use a sign-in link instead.";
  }
}

/** Skipped moments: some of these really are the person, and some aren't. */
function skippedMessage(reason?: string): string {
  switch (reason) {
    case "user_cancel":
    case "tap_outside":
      return "Google sign-in was closed before it finished. Try again, or use a sign-in link.";
    case "issuing_failed":
      return "Google couldn't issue a sign-in for that account. Use a sign-in link instead.";
    default:
      // auto_cancel and anything new: not the person's doing, so don't say it was.
      return "Google's sign-in didn't complete. Try again, or use a sign-in link.";
  }
}

/**
 * Google's own sign-in button, rendered into `container`.
 *
 * The One Tap prompt above is a *suggestion* the browser is free to refuse —
 * and increasingly does, for third-party cookie policy, FedCM migration, or
 * Google's own cooldown after a couple of dismissals. A rendered button is a
 * real button: clicking it opens the account chooser directly, with none of
 * that heuristics layer in front of it. That makes it the reliable path, so it
 * is the one the sign-in screen actually puts under the pointer.
 *
 * Returns a teardown for the resize observer the caller should run on unmount.
 */
export async function mountGoogleButton(
  container: HTMLElement,
  onCredential: (credential: string) => void,
  onError: (message: string) => void,
): Promise<() => void> {
  if (!CLIENT_ID) throw new Error("Google sign-in isn't configured for this deployment.");
  await loadGis();

  window.google.accounts.id.initialize({
    client_id: CLIENT_ID,
    callback: (resp: { credential?: string }) => {
      if (resp?.credential) onCredential(resp.credential);
      else onError("Google didn't return a sign-in.");
    },
    auto_select: false,
    cancel_on_tap_outside: true,
    use_fedcm_for_prompt: true,
  });

  // Google caps its button at 400px and ignores anything wider, so the overlay
  // is measured rather than assumed — it has to line up with the brand button
  // underneath it at every screen size.
  const draw = () => {
    const width = Math.min(400, Math.round(container.getBoundingClientRect().width) || 320);
    container.innerHTML = "";
    window.google.accounts.id.renderButton(container, {
      type: "standard",
      theme: "outline",
      size: "large",
      shape: "pill",
      text: "continue_with",
      logo_alignment: "center",
      width,
    });
  };
  draw();

  const observer = new ResizeObserver(() => draw());
  observer.observe(container);
  return () => observer.disconnect();
}

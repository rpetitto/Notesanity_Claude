import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "./lib/session";
import { Spinner, ErrorNote } from "./components/Shell";
import { api } from "./lib/api";
import Landing from "./pages/Landing";
import RolePicker from "./pages/RolePicker";
import TeacherHome from "./pages/TeacherHome";
import StudentHome from "./pages/StudentHome";
import ClassView from "./pages/ClassView";
import Gradebook from "./pages/Gradebook";
import Settings from "./pages/Settings";
// Loaded on demand: the admin console pulls in a canvas data grid that no
// student or teacher has any reason to download.
const Admin = lazy(() => import("./pages/Admin"));

import NotebookEditor from "./pages/NotebookEditor";
import UploadNotebook from "./pages/UploadNotebook";
import Workspace from "./pages/Workspace";
import AssignmentEditor from "./pages/AssignmentEditor";
import Grading from "./pages/Grading";
import TeacherAssignments from "./pages/TeacherAssignments";
import StudentNotebook, { StudentNotebookList } from "./pages/StudentNotebook";

/**
 * A student who reaches `/assignments/:id` (e.g. a stale link, or a share) never
 * belongs on the teacher grading screen — send them straight to their own
 * workspace for that assignment's notebook instead.
 */
function StudentAssignmentRedirect() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ["assignment", assignmentId],
    queryFn: () => api.get<{ assignment: { notebookId: string } }>(`/api/assignments/${assignmentId}`),
    enabled: !!assignmentId,
  });

  if (isLoading) return <Spinner label="Opening assignment…" />;
  if (error || !data) return <ErrorNote error={(error as Error) ?? new Error("Assignment not found")} />;
  return <Navigate to={`/notebooks/${data.assignment.notebookId}?assignment=${assignmentId}`} replace />;
}

/** Routes `/assignments/:id` by role — teachers grade, students land in their workspace. */
function AssignmentRoute() {
  const { user } = useSession();
  return user?.role === "teacher" ? <Grading /> : <StudentAssignmentRedirect />;
}

export default function App() {
  const { user, isLoading, error } = useSession();

  if (isLoading) return <Spinner label="Starting Notesanity…" />;
  // A signed-in Google account can still be refused (wrong email domain), so the
  // reason has to reach the landing page — otherwise sign-in silently loops.
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Landing error={error} />} />
      </Routes>
    );
  }
  if (user.role === "pending") {
    return (
      <Routes>
        <Route path="*" element={<RolePicker />} />
      </Routes>
    );
  }

  const home = user.role === "teacher" ? "/classes" : "/work";

  return (
    <Routes>
      <Route path="/" element={<Navigate to={home} replace />} />
      <Route path="/classes" element={<TeacherHome />} />
      <Route path="/classes/:classId" element={<ClassView />} />
      <Route path="/classes/:classId/upload" element={<UploadNotebook />} />
      <Route path="/classes/:classId/gradebook" element={<Gradebook />} />
      <Route path="/classes/:classId/assignments/new" element={<AssignmentEditor />} />
      <Route path="/classes/:classId/students/:studentId" element={<StudentNotebookList />} />
      <Route path="/classes/:classId/students/:studentId/notebooks/:notebookId" element={<StudentNotebook />} />
      <Route path="/assignments" element={<TeacherAssignments />} />
      <Route path="/assignments/:assignmentId" element={<AssignmentRoute />} />
      <Route path="/assignments/:assignmentId/edit" element={<AssignmentEditor />} />
      <Route path="/notebooks/:notebookId/edit" element={<NotebookEditor />} />
      <Route path="/notebooks/:notebookId" element={<Workspace />} />
      <Route path="/work" element={<StudentHome />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/admin" element={<Suspense fallback={<Spinner label="Loading admin…" />}><Admin /></Suspense>} />
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}

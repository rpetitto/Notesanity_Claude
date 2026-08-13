import { Navigate, Route, Routes } from "react-router-dom";
import { useSession } from "./lib/session";
import { Spinner } from "./components/Shell";
import Landing from "./pages/Landing";
import RolePicker from "./pages/RolePicker";
import TeacherHome from "./pages/TeacherHome";
import StudentHome from "./pages/StudentHome";
import ClassView from "./pages/ClassView";
import Gradebook from "./pages/Gradebook";
import Settings from "./pages/Settings";
import NotebookEditor from "./pages/NotebookEditor";
import UploadNotebook from "./pages/UploadNotebook";
import Workspace from "./pages/Workspace";
import AssignmentEditor from "./pages/AssignmentEditor";
import Grading from "./pages/Grading";
import TeacherAssignments from "./pages/TeacherAssignments";

export default function App() {
  const { user, isLoading } = useSession();

  if (isLoading) return <Spinner label="Starting Notesanity…" />;
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Landing />} />
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
      <Route path="/assignments" element={<TeacherAssignments />} />
      <Route path="/assignments/:assignmentId" element={<Grading />} />
      <Route path="/assignments/:assignmentId/edit" element={<AssignmentEditor />} />
      <Route path="/notebooks/:notebookId/edit" element={<NotebookEditor />} />
      <Route path="/notebooks/:notebookId" element={<Workspace />} />
      <Route path="/work" element={<StudentHome />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}

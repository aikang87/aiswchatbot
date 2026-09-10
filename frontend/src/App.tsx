import { Navigate, Route, Routes } from "react-router-dom";
import { Chat } from "./pages/Chat";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { Login } from "./pages/admin/Login";
import { Conversations } from "./pages/admin/Conversations";
import { ConversationDetail } from "./pages/admin/ConversationDetail";
import { Gaps } from "./pages/admin/Gaps";
import { Knowledge } from "./pages/admin/Knowledge";
import { Stats } from "./pages/admin/Stats";
import { Settings } from "./pages/admin/Settings";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Chat />} />
      <Route path="/admin/login" element={<Login />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="conversations" replace />} />
        <Route path="conversations" element={<Conversations />} />
        <Route path="conversations/:id" element={<ConversationDetail />} />
        <Route path="gaps" element={<Gaps />} />
        <Route path="knowledge" element={<Knowledge />} />
        <Route path="stats" element={<Stats />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { clearAdminToken, getAdminToken } from "../../api/client";

const NAV_ITEMS = [
  { to: "/admin/conversations", label: "대화 로그" },
  { to: "/admin/gaps", label: "지식 공백" },
  { to: "/admin/knowledge", label: "FAQ 관리" },
  { to: "/admin/stats", label: "통계" },
  { to: "/admin/settings", label: "설정" },
];

export function AdminLayout() {
  const navigate = useNavigate();
  const token = getAdminToken();

  if (!token) return <Navigate to="/admin/login" replace />;

  function handleLogout() {
    clearAdminToken();
    navigate("/admin/login");
  }

  return (
    <div className="flex min-h-svh">
      <aside className="w-52 shrink-0 border-r border-neutral-200 p-4 dark:border-neutral-800">
        <div className="mb-6 text-sm font-semibold text-neutral-900 dark:text-neutral-100">관리자</div>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm ${
                  isActive
                    ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          onClick={handleLogout}
          className="mt-8 w-full rounded-lg px-3 py-2 text-left text-sm text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
        >
          로그아웃
        </button>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}

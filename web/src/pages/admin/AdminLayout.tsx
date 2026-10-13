import { NavLink, Outlet } from "react-router";
import { PageHeader } from "../../components/ui";

const SECTIONS = [
  { to: "challenges", label: "Weekly" },
  { to: "goals", label: "Monthly" },
  { to: "testimonies", label: "Stories" },
  { to: "people", label: "People" },
];

/** Admin dashboard shell. Rendered only for admins (see RequireAdmin); the API enforces it too. */
export function AdminLayout() {
  return (
    <>
      <PageHeader title="Admin" subtitle="Only admins can see this tab" />
      <nav className="segmented" aria-label="Admin sections">
        {SECTIONS.map((s) => (
          <NavLink key={s.to} to={s.to} className={({ isActive }) => (isActive ? "active" : "")}>
            {s.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}

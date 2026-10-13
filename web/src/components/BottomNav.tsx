import { NavLink } from "react-router";

interface Tab {
  to: string;
  label: string;
  icon: string;
}

export const TABS: Tab[] = [
  { to: "/", label: "Home", icon: "🏠" },
  { to: "/prayer", label: "Prayer", icon: "🙏" },
  { to: "/living", label: "Living", icon: "🌱" },
  { to: "/testimonies", label: "Stories", icon: "📖" },
  { to: "/me", label: "Me", icon: "👤" },
];

const ADMIN_TAB: Tab = { to: "/admin", label: "Admin", icon: "🛠️" };

/** Persistent tab bar. The Admin tab is only rendered for users the server says are admins. */
export function BottomNav({ isAdmin }: { isAdmin: boolean }) {
  const tabs = isAdmin ? [...TABS, ADMIN_TAB] : TABS;
  return (
    <nav className="bottom-nav" aria-label="Main">
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.to === "/"} className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
          <span className="tab-icon" aria-hidden="true">
            {tab.icon}
          </span>
          <span className="tab-label">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

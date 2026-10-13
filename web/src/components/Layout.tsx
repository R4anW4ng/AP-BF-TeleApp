import { Outlet } from "react-router";
import { useMe } from "../api";
import { BottomNav } from "./BottomNav";

export function Layout() {
  const { data: me } = useMe();
  return (
    <div className="app">
      <main className="content">
        <Outlet />
      </main>
      <BottomNav isAdmin={me?.isAdmin ?? false} />
    </div>
  );
}

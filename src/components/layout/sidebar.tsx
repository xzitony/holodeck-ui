"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useUI } from "@/providers/ui-provider";

interface NavItem {
  label: string;
  href: string;
  icon: string;
  minRole?: "labadmin" | "superadmin";
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard/environment", icon: "🔗" },
  { label: "My Reservations", href: "/dashboard/reservations", icon: "▦" },
  { label: "History", href: "/dashboard/history", icon: "☰" },
];

const adminItems: NavItem[] = [
  { label: "Configs", href: "/dashboard/admin/holodeck-configs", icon: "🗂", minRole: "superadmin" },
  { label: "Instances", href: "/dashboard/instances", icon: "◈" },
  { label: "Day 2 Ops", href: "/dashboard/day2", icon: "🔧" },
  { label: "Depot Appliance", href: "/dashboard/depot", icon: "📦", minRole: "superadmin" },
  { label: "Users", href: "/dashboard/admin/users", icon: "👤" },
  { label: "Reservations", href: "/dashboard/admin/reservations", icon: "📅" },
  { label: "API Docs", href: "/dashboard/developer", icon: "{ }" },
  { label: "Settings", href: "/dashboard/admin/config", icon: "⚙" },
];

function NavLink({
  item,
  active,
  collapsed,
}: {
  item: { label: string; href: string; icon: string };
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      href={item.href}
      className={`relative group flex items-center ${collapsed ? "justify-center" : "gap-3"} px-3 py-2 rounded-md text-sm transition-colors ${
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      <span>{item.icon}</span>
      {!collapsed && item.label}
      {collapsed && (
        <span className="absolute left-full ml-2 px-2 py-1 rounded-md bg-card border border-border text-foreground text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg">
          {item.label}
        </span>
      )}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const ui = useUI();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`${collapsed ? "w-16" : "w-52"} border-r border-border flex flex-col h-full transition-all duration-200`}
      style={ui.ui_color_sidebar ? { backgroundColor: ui.ui_color_sidebar } : undefined}
    >
      <nav className="flex-1 p-3 space-y-1 pt-4">
        {navItems
          .filter((item) => {
            if (!item.minRole) return true;
            const roleLevel: Record<string, number> = { user: 0, labadmin: 1, superadmin: 2 };
            return roleLevel[user?.role || "user"] >= roleLevel[item.minRole];
          })
          .map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={pathname === item.href}
            collapsed={collapsed}
          />
        ))}

        {(user?.role === "labadmin" || user?.role === "superadmin") && (
          <>
            {!collapsed ? (
              <div className="pt-4 pb-2">
                <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Admin
                </p>
              </div>
            ) : (
              <div className="pt-4 border-t border-border mt-2" />
            )}
            {adminItems
              .filter((item) => {
                if (!("minRole" in item)) return true;
                const roleLevel: Record<string, number> = { user: 0, labadmin: 1, superadmin: 2 };
                return roleLevel[user?.role || "user"] >= roleLevel[item.minRole || "labadmin"];
              })
              .map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={pathname === item.href || (item.href === "/dashboard/instances" && pathname.startsWith("/dashboard/deployments/"))}
                collapsed={collapsed}
              />
            ))}
          </>
        )}
      </nav>

      <div className="p-3 border-t border-border">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="relative group w-full flex items-center justify-center px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          {collapsed ? "»" : "« Collapse"}
          {collapsed && (
            <span className="absolute left-full ml-2 px-2 py-1 rounded-md bg-card border border-border text-foreground text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg">
              Expand
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}

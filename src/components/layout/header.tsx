"use client";

import { useAuth } from "@/hooks/use-auth";
import { useUI } from "@/providers/ui-provider";

const roleBadgeColors: Record<string, string> = {
  superadmin: "bg-red-500/20 text-red-400",
  labadmin: "bg-yellow-500/20 text-yellow-400",
  user: "bg-blue-500/20 text-blue-400",
};

const roleLabels: Record<string, string> = {
  superadmin: "Super Admin",
  labadmin: "Lab Admin",
  user: "User",
};

export function Header() {
  const { user, logout } = useAuth();
  const ui = useUI();

  return (
    <header className="h-14 border-b border-border bg-card px-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        {ui.ui_logo_url && (
          <img
            src={ui.ui_logo_url}
            alt="Logo"
            className="h-8 object-contain"
          />
        )}
        <div className="min-w-0">
          <h1 className="font-bold text-sm leading-tight">{ui.ui_app_title}</h1>
          <p className="text-xs text-muted-foreground leading-tight">{ui.ui_app_subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        {user && (
          <>
            <span
              className={`text-xs px-2 py-1 rounded-full ${
                roleBadgeColors[user.role] || ""
              }`}
            >
              {roleLabels[user.role] || user.role}
            </span>
            <span className="text-sm">{user.displayName}</span>
            <button
              onClick={logout}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign Out
            </button>
          </>
        )}
      </div>
    </header>
  );
}

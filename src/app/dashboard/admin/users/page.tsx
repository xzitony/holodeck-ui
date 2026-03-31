"use client";

import { useEffect, useState } from "react";

interface User {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  role: string;
  enabled: boolean;
  createdAt: string;
}

const roleLabels: Record<string, string> = {
  superadmin: "Super Admin",
  labadmin: "Lab Admin",
  user: "User",
};

export default function ManageUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [form, setForm] = useState({
    username: "",
    password: "",
    displayName: "",
    email: "",
    role: "user" as string,
  });
  const [error, setError] = useState("");

  const fetchUsers = async () => {
    const res = await fetch("/api/users");
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users || []);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to create user");
      return;
    }

    setShowForm(false);
    setForm({ username: "", password: "", displayName: "", email: "", role: "user" });
    fetchUsers();
  };

  const handleUpdate = async (id: string, data: Record<string, unknown>) => {
    await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    fetchUsers();
  };

  const handleDisable = async (id: string) => {
    if (!confirm("Disable this user? They will not be able to log in."))
      return;
    await fetch(`/api/users/${id}`, { method: "DELETE" });
    fetchUsers();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Manage Users</h1>
        <button
          onClick={() => {
            setShowForm(!showForm);
            setEditUser(null);
          }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90"
        >
          {showForm ? "Cancel" : "Add User"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-card border border-border rounded-lg p-4 space-y-4"
        >
          <h2 className="font-semibold">Create New User</h2>
          {error && (
            <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Username
              </label>
              <input
                type="text"
                value={form.username}
                onChange={(e) =>
                  setForm((f) => ({ ...f, username: e.target.value }))
                }
                className="w-full px-3 py-2 bg-input border border-border rounded-md"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Password
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) =>
                  setForm((f) => ({ ...f, password: e.target.value }))
                }
                className="w-full px-3 py-2 bg-input border border-border rounded-md"
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={form.displayName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, displayName: e.target.value }))
                }
                className="w-full px-3 py-2 bg-input border border-border rounded-md"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Email
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm((f) => ({ ...f, email: e.target.value }))
                }
                placeholder="user@example.com"
                className="w-full px-3 py-2 bg-input border border-border rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Role</label>
              <select
                value={form.role}
                onChange={(e) =>
                  setForm((f) => ({ ...f, role: e.target.value }))
                }
                className="w-full px-3 py-2 bg-input border border-border rounded-md"
              >
                <option value="user">User</option>
                <option value="labadmin">Lab Admin</option>
                <option value="superadmin">Super Admin</option>
              </select>
            </div>
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90"
          >
            Create User
          </button>
        </form>
      )}

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wider">
              <th className="px-4 py-3">Username</th>
              <th className="px-4 py-3">Display Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border/50">
                <td className="px-4 py-3 text-sm font-mono">{u.username}</td>
                <td className="px-4 py-3 text-sm">
                  {editUser?.id === u.id ? (
                    <input
                      type="text"
                      defaultValue={u.displayName}
                      onBlur={(e) =>
                        handleUpdate(u.id, {
                          displayName: e.target.value,
                        })
                      }
                      className="px-2 py-1 bg-input border border-border rounded text-sm"
                      autoFocus
                    />
                  ) : (
                    u.displayName
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {editUser?.id === u.id ? (
                    <input
                      type="email"
                      defaultValue={u.email || ""}
                      onBlur={(e) =>
                        handleUpdate(u.id, {
                          email: e.target.value,
                        })
                      }
                      placeholder="user@example.com"
                      className="px-2 py-1 bg-input border border-border rounded text-sm"
                    />
                  ) : (
                    u.email || "—"
                  )}
                </td>
                <td className="px-4 py-3 text-sm">
                  {editUser?.id === u.id ? (
                    <select
                      defaultValue={u.role}
                      onChange={(e) =>
                        handleUpdate(u.id, { role: e.target.value })
                      }
                      className="px-2 py-1 bg-input border border-border rounded text-sm"
                    >
                      <option value="user">User</option>
                      <option value="labadmin">Lab Admin</option>
                      <option value="superadmin">Super Admin</option>
                    </select>
                  ) : (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        u.role === "superadmin"
                          ? "bg-red-500/20 text-red-400"
                          : u.role === "labadmin"
                          ? "bg-yellow-500/20 text-yellow-400"
                          : "bg-blue-500/20 text-blue-400"
                      }`}
                    >
                      {roleLabels[u.role] || u.role}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      u.enabled
                        ? "bg-success/20 text-success"
                        : "bg-destructive/20 text-destructive"
                    }`}
                  >
                    {u.enabled ? "Active" : "Disabled"}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm space-x-2">
                  <button
                    onClick={() =>
                      setEditUser(editUser?.id === u.id ? null : u)
                    }
                    className="text-primary hover:underline"
                  >
                    {editUser?.id === u.id ? "Done" : "Edit"}
                  </button>
                  {u.enabled && (
                    <button
                      onClick={() => handleDisable(u.id)}
                      className="text-destructive hover:underline"
                    >
                      Disable
                    </button>
                  )}
                  {!u.enabled && (
                    <button
                      onClick={() =>
                        handleUpdate(u.id, { enabled: true })
                      }
                      className="text-success hover:underline"
                    >
                      Enable
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

interface CommandParam {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "select";
  required: boolean;
  validation?: string;
  placeholder?: string;
  options?: string[];
}

interface Command {
  id: string;
  name: string;
  slug: string;
  description: string;
  template: string;
  parameters: string;
  category: string;
  requiredRole: string;
  isEnabled: boolean;
  isBuiltIn: boolean;
  sortOrder: number;
}

const categories = ["inventory", "network", "lifecycle", "maintenance", "day2", "deployment"];
const roles = [
  { value: "user", label: "User" },
  { value: "labadmin", label: "Lab Admin" },
  { value: "superadmin", label: "Super Admin" },
];

const emptyParam: CommandParam = {
  name: "",
  label: "",
  type: "string",
  required: true,
};

const emptyCommand = {
  name: "",
  slug: "",
  description: "",
  template: "",
  category: "inventory",
  requiredRole: "user",
  sortOrder: 99,
  parameters: [] as CommandParam[],
};

export default function ManageCommandsPage() {
  const [commands, setCommands] = useState<Command[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Command>>({});

  // New command form
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newCmd, setNewCmd] = useState({ ...emptyCommand });
  const [newParams, setNewParams] = useState<CommandParam[]>([]);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");

  const fetchCommands = async () => {
    const res = await fetch("/api/commands?all=true");
    if (res.ok) {
      const data = await res.json();
      setCommands(
        (data.commands || []).map((c: Command & { parameters: unknown }) => ({
          ...c,
          parameters:
            typeof c.parameters === "string"
              ? c.parameters
              : JSON.stringify(c.parameters, null, 2),
        }))
      );
    }
  };

  useEffect(() => {
    fetchCommands();
  }, []);

  const handleEdit = (cmd: Command) => {
    setEditing(cmd.id);
    setEditData({
      name: cmd.name,
      description: cmd.description,
      template: cmd.template,
      category: cmd.category,
      requiredRole: cmd.requiredRole,
    });
  };

  const handleSave = async (id: string) => {
    await fetch(`/api/commands/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editData),
    });
    setEditing(null);
    fetchCommands();
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await fetch(`/api/commands/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isEnabled: !enabled }),
    });
    fetchCommands();
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/commands/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage(data.message || "Command deleted");
      } else {
        setMessage(`Error: ${data.error || "Failed to delete"}`);
      }
    } catch {
      setMessage("Error: Failed to delete command");
    }
    setDeletingId(null);
    fetchCommands();
  };

  // Auto-generate slug from name
  const updateNewName = (name: string) => {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    setNewCmd((prev) => ({ ...prev, name, slug }));
  };

  const addParam = () => {
    setNewParams((prev) => [...prev, { ...emptyParam }]);
  };

  const updateParam = (index: number, updates: Partial<CommandParam>) => {
    setNewParams((prev) =>
      prev.map((p, i) => (i === index ? { ...p, ...updates } : p))
    );
  };

  const removeParam = (index: number) => {
    setNewParams((prev) => prev.filter((_, i) => i !== index));
  };

  const resetNewForm = () => {
    setShowNewForm(false);
    setNewCmd({ ...emptyCommand });
    setNewParams([]);
    setMessage("");
  };

  const handleCreate = async () => {
    if (!newCmd.name || !newCmd.template) {
      setMessage("Error: Name and template are required.");
      return;
    }
    setCreating(true);
    setMessage("");

    // Clean up params — remove empty ones, parse options
    const cleanParams = newParams
      .filter((p) => p.name && p.label)
      .map((p) => {
        const param: CommandParam = {
          name: p.name,
          label: p.label,
          type: p.type,
          required: p.required,
        };
        if (p.validation) param.validation = p.validation;
        if (p.placeholder) param.placeholder = p.placeholder;
        if (p.type === "select" && p.options) {
          param.options = typeof p.options === "string"
            ? (p.options as unknown as string).split(",").map((o: string) => o.trim()).filter(Boolean)
            : p.options;
        }
        return param;
      });

    try {
      const res = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newCmd,
          parameters: cleanParams,
        }),
      });
      if (res.ok) {
        setMessage("Command created successfully");
        resetNewForm();
        await fetchCommands();
      } else {
        const data = await res.json();
        setMessage(`Error: ${data.error || "Failed to create command"}`);
      }
    } catch {
      setMessage("Error: Failed to create command");
    }
    setCreating(false);
  };

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Manage Commands</h1>
          <p className="text-muted-foreground mt-1">
            View, edit, and add Holodeck command definitions. These are the
            commands available to admins on the Run Commands page.
          </p>
        </div>
        <button
          onClick={() => setShowNewForm(true)}
          className="px-4 py-2 bg-success text-success-foreground rounded-md font-medium hover:opacity-90 whitespace-nowrap"
        >
          + Add Command
        </button>
      </div>

      {message && !showNewForm && (
        <div
          className={`p-3 rounded-md text-sm ${
            message.startsWith("Error")
              ? "bg-destructive/10 text-destructive"
              : "bg-success/10 text-success"
          }`}
        >
          {message}
        </div>
      )}

      {/* New Command Form */}
      {showNewForm && (
        <div className="bg-card border border-primary/50 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg">Add New Command</h2>
            <button
              onClick={resetNewForm}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>

          {/* Basic fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">
                Name <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={newCmd.name}
                onChange={(e) => updateNewName(e.target.value)}
                className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm"
                placeholder="e.g. View Pod Status"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Slug</label>
              <input
                type="text"
                value={newCmd.slug}
                onChange={(e) =>
                  setNewCmd((prev) => ({ ...prev, slug: e.target.value }))
                }
                className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm font-mono"
                placeholder="auto-generated-from-name"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Auto-generated from name. Must be unique.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Description</label>
            <input
              type="text"
              value={newCmd.description}
              onChange={(e) =>
                setNewCmd((prev) => ({ ...prev, description: e.target.value }))
              }
              className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm"
              placeholder="Brief description of what the command does"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">
              Template <span className="text-destructive">*</span>
            </label>
            <textarea
              value={newCmd.template}
              onChange={(e) =>
                setNewCmd((prev) => ({ ...prev, template: e.target.value }))
              }
              rows={2}
              className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm font-mono resize-none"
              placeholder="e.g. Get-HoloDeckSubnet -Site '{{site}}'"
            />
            <p className="text-xs text-muted-foreground mt-1">
              PowerShell command template. Use <code className="bg-muted px-1 rounded">{"{{paramName}}"}</code> for
              parameter placeholders and <code className="bg-muted px-1 rounded">{"{{#flag}}...{{/flag}}"}</code> for
              conditional sections.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Category</label>
              <select
                value={newCmd.category}
                onChange={(e) =>
                  setNewCmd((prev) => ({ ...prev, category: e.target.value }))
                }
                className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                Required Role
              </label>
              <select
                value={newCmd.requiredRole}
                onChange={(e) =>
                  setNewCmd((prev) => ({
                    ...prev,
                    requiredRole: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm"
              >
                {roles.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                Sort Order
              </label>
              <input
                type="number"
                value={newCmd.sortOrder}
                onChange={(e) =>
                  setNewCmd((prev) => ({
                    ...prev,
                    sortOrder: parseInt(e.target.value) || 0,
                  }))
                }
                className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm"
              />
            </div>
          </div>

          {/* Parameters */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium">Parameters</label>
              <button
                onClick={addParam}
                className="text-xs px-2 py-1 bg-secondary text-secondary-foreground rounded-md hover:opacity-90"
              >
                + Add Parameter
              </button>
            </div>

            {newParams.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No parameters. Click &quot;Add Parameter&quot; to define inputs
                that map to template placeholders.
              </p>
            )}

            {newParams.map((param, i) => (
              <div
                key={i}
                className="bg-background/50 border border-border rounded-md p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Parameter {i + 1}
                  </span>
                  <button
                    onClick={() => removeParam(i)}
                    className="text-xs text-destructive hover:underline"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-0.5">
                      Name
                    </label>
                    <input
                      type="text"
                      value={param.name}
                      onChange={(e) => updateParam(i, { name: e.target.value })}
                      className="w-full px-2 py-1.5 bg-input border border-border rounded text-xs font-mono"
                      placeholder="paramName"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-0.5">
                      Label
                    </label>
                    <input
                      type="text"
                      value={param.label}
                      onChange={(e) =>
                        updateParam(i, { label: e.target.value })
                      }
                      className="w-full px-2 py-1.5 bg-input border border-border rounded text-xs"
                      placeholder="Display Label"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-0.5">
                      Type
                    </label>
                    <select
                      value={param.type}
                      onChange={(e) =>
                        updateParam(i, {
                          type: e.target.value as CommandParam["type"],
                        })
                      }
                      className="w-full px-2 py-1.5 bg-input border border-border rounded text-xs"
                    >
                      <option value="string">String</option>
                      <option value="number">Number</option>
                      <option value="boolean">Boolean</option>
                      <option value="select">Select</option>
                    </select>
                  </div>
                  <div className="flex items-end gap-2">
                    <label className="flex items-center gap-1 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={param.required}
                        onChange={(e) =>
                          updateParam(i, { required: e.target.checked })
                        }
                        className="accent-primary"
                      />
                      Required
                    </label>
                  </div>
                </div>
                {param.type === "select" && (
                  <div>
                    <label className="block text-xs text-muted-foreground mb-0.5">
                      Options (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={
                        Array.isArray(param.options)
                          ? param.options.join(", ")
                          : param.options || ""
                      }
                      onChange={(e) =>
                        updateParam(i, {
                          options: e.target.value as unknown as string[],
                        })
                      }
                      className="w-full px-2 py-1.5 bg-input border border-border rounded text-xs"
                      placeholder="e.g. a, b"
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-muted-foreground mb-0.5">
                      Placeholder
                    </label>
                    <input
                      type="text"
                      value={param.placeholder || ""}
                      onChange={(e) =>
                        updateParam(i, { placeholder: e.target.value })
                      }
                      className="w-full px-2 py-1.5 bg-input border border-border rounded text-xs"
                      placeholder="Hint text shown in input"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-0.5">
                      Validation Regex
                    </label>
                    <input
                      type="text"
                      value={param.validation || ""}
                      onChange={(e) =>
                        updateParam(i, { validation: e.target.value })
                      }
                      className="w-full px-2 py-1.5 bg-input border border-border rounded text-xs font-mono"
                      placeholder="e.g. ^[a-zA-Z0-9._-]+$"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {message && (
            <div
              className={`p-3 rounded-md text-sm ${
                message.startsWith("Error")
                  ? "bg-destructive/10 text-destructive"
                  : "bg-success/10 text-success"
              }`}
            >
              {message}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={resetNewForm}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:opacity-90"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90 disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create Command"}
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-lg p-6 max-w-md w-full mx-4 space-y-4">
            <h3 className="text-lg font-semibold">Delete Command</h3>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">
                {commands.find((c) => c.id === deletingId)?.name}
              </span>
              ? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeletingId(null)}
                className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm hover:opacity-90"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deletingId)}
                className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md text-sm font-medium hover:opacity-90"
              >
                Delete Command
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Existing commands list */}
      <div className="space-y-3">
        {commands.map((cmd) => (
          <div
            key={cmd.id}
            className={`bg-card border rounded-lg p-4 ${
              cmd.isEnabled ? "border-border" : "border-border opacity-60"
            }`}
          >
            {editing === cmd.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      Name
                    </label>
                    <input
                      type="text"
                      value={editData.name || ""}
                      onChange={(e) =>
                        setEditData((d) => ({ ...d, name: e.target.value }))
                      }
                      className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      Category
                    </label>
                    <select
                      value={editData.category || "inventory"}
                      onChange={(e) =>
                        setEditData((d) => ({
                          ...d,
                          category: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm"
                    >
                      {categories.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={editData.description || ""}
                    onChange={(e) =>
                      setEditData((d) => ({
                        ...d,
                        description: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">
                    Template
                  </label>
                  <textarea
                    value={editData.template || ""}
                    onChange={(e) =>
                      setEditData((d) => ({
                        ...d,
                        template: e.target.value,
                      }))
                    }
                    rows={2}
                    className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm font-mono resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">
                    Required Role
                  </label>
                  <select
                    value={editData.requiredRole || "user"}
                    onChange={(e) =>
                      setEditData((d) => ({
                        ...d,
                        requiredRole: e.target.value,
                      }))
                    }
                    className="px-3 py-2 bg-input border border-border rounded-md text-sm"
                  >
                    {roles.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSave(cmd.id)}
                    className="px-3 py-1 bg-primary text-primary-foreground rounded-md text-sm"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    className="px-3 py-1 bg-secondary text-secondary-foreground rounded-md text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{cmd.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {cmd.category}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {cmd.requiredRole}+
                    </span>
                    {!cmd.isEnabled && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/20 text-destructive">
                        Disabled
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {cmd.description}
                  </p>
                  <p className="text-xs font-mono text-muted-foreground mt-1 break-all">
                    {cmd.template}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0 ml-3">
                  <button
                    onClick={() => handleEdit(cmd)}
                    className="text-sm text-primary hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleToggle(cmd.id, cmd.isEnabled)}
                    className={`text-sm hover:underline ${
                      cmd.isEnabled ? "text-warning" : "text-success"
                    }`}
                  >
                    {cmd.isEnabled ? "Disable" : "Enable"}
                  </button>
                  {!cmd.isBuiltIn && (
                    <button
                      onClick={() => setDeletingId(cmd.id)}
                      className="text-sm text-destructive hover:underline"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

import { z } from "zod/v4";

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export const createUserSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(8),
  displayName: z.string().min(1).max(100),
  email: z.string().email().optional().or(z.literal("")),
  role: z.enum(["superadmin", "labadmin", "user"]),
});

export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional().or(z.literal("")),
  role: z.enum(["superadmin", "labadmin", "user"]).optional(),
  enabled: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

export const createReservationSchema = z
  .object({
    title: z.string().min(1).max(200),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    notes: z.string().max(1000).optional(),
    isMaintenance: z.boolean().optional(),
    isCustomerDemo: z.boolean().optional(),
  })
  .refine((data) => new Date(data.endTime) > new Date(data.startTime), {
    message: "End time must be after start time",
  });

export const executeCommandSchema = z.object({
  commandId: z.string().min(1),
  parameters: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])).optional(),
  configId: z.string().optional(),
});

export const globalConfigSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  sensitive: z.boolean().optional(),
  description: z.string().optional(),
});

export interface CommandParameter {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "select";
  required: boolean;
  validation?: string;
  placeholder?: string;
  options?: string[];
}

export function validateCommandParameters(
  params: Record<string, unknown>,
  definitions: CommandParameter[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const def of definitions) {
    const value = params[def.name];

    if (def.required && (value === undefined || value === "" || value === null)) {
      errors.push(`${def.label} is required`);
      continue;
    }

    if (value === undefined || value === "" || value === null) continue;

    if (def.type === "select" && def.options) {
      if (!def.options.includes(String(value))) {
        errors.push(`${def.label} must be one of: ${def.options.join(", ")}`);
      }
    }

    if (def.validation && typeof value === "string") {
      const regex = new RegExp(def.validation);
      if (!regex.test(value)) {
        errors.push(`${def.label} has an invalid format`);
      }
    }
  }

  // Reject unknown parameters
  const knownNames = new Set(definitions.map((d) => d.name));
  for (const key of Object.keys(params)) {
    if (!knownNames.has(key)) {
      errors.push(`Unknown parameter: ${key}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function resolveTemplate(
  template: string,
  params: Record<string, unknown>
): string {
  let resolved = template;

  // Handle conditional sections: {{#flag}} ... {{/flag}}
  resolved = resolved.replace(
    /\{\{#(\w+)\}\}(.*?)\{\{\/\1\}\}/g,
    (_, key, content) => {
      const value = params[key];
      if (value === true || (typeof value === "string" && value.length > 0)) {
        return resolveTemplate(content, params);
      }
      return "";
    }
  );

  // Handle simple placeholders: {{key}}
  resolved = resolved.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = params[key];
    if (value === undefined || value === null) return "";
    return shellEscape(String(value));
  });

  return resolved.replace(/\s+/g, " ").trim();
}

function shellEscape(value: string): string {
  // Reject dangerous characters outright
  if (/[;|`$(){}\\<>&!]/.test(value)) {
    throw new Error(`Parameter contains prohibited characters: ${value}`);
  }
  return value;
}

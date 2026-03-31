import { getUserFromRequest, hasMinimumRole, type UserRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkReservationAccess } from "@/lib/reservation-guard";
import {
  executeCommandSchema,
  validateCommandParameters,
  resolveTemplate,
  type CommandParameter,
} from "@/lib/validators";
import { executeCommand } from "@/lib/ssh";

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse input
  const body = await request.json();
  const parsed = executeCommandSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid input" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Load command definition
  const commandDef = await prisma.commandDefinition.findUnique({
    where: { id: parsed.data.commandId },
  });
  if (!commandDef || !commandDef.isEnabled) {
    return new Response(JSON.stringify({ error: "Command not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Role check
  if (!hasMinimumRole(user.role, commandDef.requiredRole as UserRole)) {
    return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Reservation check
  const access = await checkReservationAccess(user.userId, user.role);
  if (!access.allowed) {
    return new Response(JSON.stringify({ error: access.message }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate parameters
  const paramDefs = JSON.parse(commandDef.parameters) as CommandParameter[];
  const params = (parsed.data.parameters || {}) as Record<string, unknown>;
  const validation = validateCommandParameters(params, paramDefs);
  if (!validation.valid) {
    return new Response(
      JSON.stringify({ error: "Invalid parameters", details: validation.errors }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Inject global config values
  const globalConfigs = await prisma.globalConfig.findMany();
  const configMap = Object.fromEntries(globalConfigs.map((c) => [c.key, c.value]));
  const allParams = { ...configMap, ...params };

  // Resolve template
  let resolvedCommand: string;
  try {
    const rawCommand = resolveTemplate(commandDef.template, allParams);
    // Prepend Import-HoloDeckConfig if a configId was provided
    const configId = parsed.data.configId;
    let fullCommand = rawCommand;
    if (configId) {
      // Validate configId format
      if (!/^[a-zA-Z0-9._-]+$/.test(configId)) {
        throw new Error("Invalid config ID format");
      }
      fullCommand = `Import-HoloDeckConfig -ConfigID '${configId}' | Out-Null; ${rawCommand}`;
    }
    // Wrap in pwsh -NonInteractive, with PlainText rendering to suppress ANSI codes
    const escapedForBash = fullCommand.replace(/'/g, "'\\''");
    resolvedCommand = `pwsh -NonInteractive -Command '$PSStyle.OutputRendering = \"PlainText\"; ${escapedForBash}'`;
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Template error",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Create audit log entry
  const audit = await prisma.auditLog.create({
    data: {
      userId: user.userId,
      action: "command_execute",
      commandId: commandDef.id,
      details: JSON.stringify({
        command: commandDef.slug,
        parameters: params,
        resolvedCommand,
      }),
      status: "success",
      ipAddress: request.headers.get("x-forwarded-for") || "unknown",
    },
  });

  // Stream SSE response
  const startTime = Date.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        const result = await executeCommand(
          resolvedCommand,
          (line, streamType) => {
            send("output", { line, stream: streamType });
          }
        );

        send("complete", {
          exitCode: result.exitCode,
          duration: Date.now() - startTime,
        });

        // Update audit log
        await prisma.auditLog.update({
          where: { id: audit.id },
          data: {
            status: result.exitCode === 0 ? "success" : "failure",
            details: JSON.stringify({
              command: commandDef.slug,
              parameters: params,
              exitCode: result.exitCode,
              duration: Date.now() - startTime,
            }),
          },
        });
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : "Execution error",
        });

        await prisma.auditLog.update({
          where: { id: audit.id },
          data: { status: "error" },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { executeCommand } from "@/lib/ssh";

/**
 * POST /api/holodeck-configs/sync — fetch configs from holorouter and sync local DB
 *
 * Three-phase sync:
 *   Phase 1: Get-HoloDeckConfig — list all configs (includes Instance ID if deployed)
 *   Phase 2: Import-HoloDeckConfig — fetch full config JSON for each
 *   Phase 3: For configs with instances, read output.json + latest state file
 *
 * Any authenticated user can trigger a sync (read-only operation on the holorouter).
 */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Phase 1: List all configs from holorouter
    const listResult = await executeCommand(
      `pwsh -NonInteractive -Command '$PSStyle.OutputRendering = "PlainText"; Get-HoloDeckConfig | ConvertTo-Json -Depth 3'`,
      undefined,
      20000
    );

    const stdout = stripAnsi(listResult.stdout).trim();
    let remoteConfigs: Array<Record<string, string>>;
    try {
      const parsed = JSON.parse(stdout);
      remoteConfigs = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      remoteConfigs = parseTextOutput(stdout);
    }

    if (remoteConfigs.length === 0) {
      const staleCount = await prisma.holoDeckConfig.count();
      if (staleCount > 0) {
        await prisma.holoDeckConfig.deleteMany();
      }
      return NextResponse.json({
        message: staleCount > 0
          ? `No configs found on holorouter. Removed ${staleCount} stale cached config(s).`
          : "No configs found on holorouter",
        synced: 0,
        removed: staleCount,
        configs: [],
      });
    }

    const synced: Array<{ configId: string; description: string; hasInstance: boolean; instanceStatus: string | null }> = [];

    for (const remoteCfg of remoteConfigs) {
      const configId = remoteCfg.ConfigID || remoteCfg.configId;
      if (!configId) continue;

      // Phase 2: Import full config JSON
      let fullJson: string | null = null;
      try {
        const importResult = await executeCommand(
          `pwsh -NonInteractive -Command '$PSStyle.OutputRendering = "PlainText"; Import-HoloDeckConfig -ConfigID "${configId}" | Out-Null; $config | ConvertTo-Json -Depth 100'`,
          undefined,
          20000
        );
        const importOut = stripAnsi(importResult.stdout).trim();
        JSON.parse(importOut);
        fullJson = importOut;
      } catch {
        fullJson = JSON.stringify(remoteCfg);
      }

      // Phase 3: Check for deployed instance
      // Instance ID comes from Get-HoloDeckConfig list output (remoteCfg),
      // NOT from the imported config JSON — Instance is a runtime property.
      const instanceId = remoteCfg.Instance || null;
      let instanceJson: string | null = null;
      let stateJson: string | null = null;

      if (instanceId) {
        // 3a: Read output.json — nodes, power state, reachability
        try {
          const outputResult = await executeCommand(
            `cat /holodeck-runtime/output/${instanceId}.json`,
            undefined,
            10000
          );
          const outputOut = stripAnsi(outputResult.stdout).trim();
          JSON.parse(outputOut);
          instanceJson = outputOut;
        } catch {
          // output.json missing — fall back to Get-HoloDeckInstance
          try {
            const instResult = await executeCommand(
              `pwsh -NonInteractive -Command '$PSStyle.OutputRendering = "PlainText"; Import-HoloDeckConfig -ConfigID "${configId}" | Out-Null; Get-HoloDeckInstance -InstanceID "${instanceId}" | ConvertTo-Json -Depth 10'`,
              undefined,
              20000
            );
            const instOut = stripAnsi(instResult.stdout).trim();
            JSON.parse(instOut);
            instanceJson = instOut;
          } catch {
            // Can't get instance data at all
          }
        }

        // 3b: Read most recent state file — deployment execution tree
        try {
          const stateResult = await executeCommand(
            `cat "$(ls -t /holodeck-runtime/state/holodeck-runtime-state_*.json 2>/dev/null | head -1)" 2>/dev/null`,
            undefined,
            10000
          );
          const stateOut = stripAnsi(stateResult.stdout).trim();
          if (stateOut) {
            JSON.parse(stateOut);
            stateJson = stateOut;
          }
        } catch {
          // No state file available
        }
      }

      // Upsert local record
      const existing = await prisma.holoDeckConfig.findUnique({
        where: { configId },
      });

      if (existing) {
        await prisma.holoDeckConfig.update({
          where: { configId },
          data: {
            cachedJson: fullJson,
            instanceJson,
            stateJson,
            lastSynced: new Date(),
          },
        });
      } else {
        await prisma.holoDeckConfig.create({
          data: {
            configId,
            description: remoteCfg.Description || "",
            cachedJson: fullJson,
            instanceJson,
            stateJson,
            lastSynced: new Date(),
          },
        });
      }

      let instanceStatus: string | null = null;
      if (instanceJson) {
        try {
          instanceStatus = JSON.parse(instanceJson).Status || null;
        } catch {
          // ignore
        }
      }

      synced.push({
        configId,
        description: remoteCfg.Description || "",
        hasInstance: !!instanceId,
        instanceStatus,
      });
    }

    // Clean up: remove local configs that no longer exist on holorouter
    const remoteIds = synced.map((s) => s.configId);
    const localConfigs = await prisma.holoDeckConfig.findMany();
    for (const local of localConfigs) {
      if (!remoteIds.includes(local.configId)) {
        await prisma.holoDeckConfig.delete({ where: { configId: local.configId } });
      }
    }

    return NextResponse.json({
      message: `Synced ${synced.length} config(s) from holorouter`,
      synced: synced.length,
      configs: synced,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sync configs" },
      { status: 500 }
    );
  }
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[\x20-\x3f]*[0-9;]*[\x20-\x7e]|\x1b\].*?(\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[>=<]|\x1b\[\?[0-9;]*[a-zA-Z]|\r/g, "");
}

function parseTextOutput(text: string): Array<Record<string, string>> {
  const configs: Array<Record<string, string>> = [];
  let current: Record<string, string> = {};

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      if (Object.keys(current).length > 0) {
        configs.push(current);
        current = {};
      }
      continue;
    }
    const match = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (match) {
      current[match[1]] = match[2].trim();
    }
  }

  if (Object.keys(current).length > 0) {
    configs.push(current);
  }

  return configs;
}

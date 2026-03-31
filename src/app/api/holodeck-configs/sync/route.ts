import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { executeCommand } from "@/lib/ssh";

/**
 * POST /api/holodeck-configs/sync — fetch configs from holorouter and sync local DB
 *
 * 1. Runs Get-HoloDeckConfig to list all configs
 * 2. For each config, runs Import-HoloDeckConfig to get full JSON
 * 3. Creates/updates local HoloDeckConfig records with cached JSON
 *
 * Any authenticated user can trigger a sync (read-only operation on the holorouter).
 */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Step 1: Get list of all configs from holorouter
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
      return NextResponse.json({
        message: "No configs found on holorouter",
        synced: 0,
        configs: [],
      });
    }

    // Step 2: For each config, fetch full JSON via Import-HoloDeckConfig
    const synced: Array<{ configId: string; description: string; hasInstance: boolean }> = [];

    for (const remoteCfg of remoteConfigs) {
      const configId = remoteCfg.ConfigID || remoteCfg.configId;
      if (!configId) continue;

      let fullJson: string | null = null;
      try {
        const importResult = await executeCommand(
          `pwsh -NonInteractive -Command '$PSStyle.OutputRendering = "PlainText"; Import-HoloDeckConfig -ConfigID "${configId}" | Out-Null; $config | ConvertTo-Json -Depth 100'`,
          undefined,
          20000
        );
        const importOut = stripAnsi(importResult.stdout).trim();
        // Verify it's valid JSON
        JSON.parse(importOut);
        fullJson = importOut;
      } catch {
        // Can't import this config's JSON — store what we have from the list
        fullJson = JSON.stringify(remoteCfg);
      }

      // Step 3: Upsert local record
      const existing = await prisma.holoDeckConfig.findUnique({
        where: { configId },
      });

      if (existing) {
        await prisma.holoDeckConfig.update({
          where: { configId },
          data: {
            cachedJson: fullJson,
            lastSynced: new Date(),
          },
        });
      } else {
        await prisma.holoDeckConfig.create({
          data: {
            configId,
            description: remoteCfg.Description || "",
            cachedJson: fullJson,
            lastSynced: new Date(),
          },
        });
      }

      synced.push({
        configId,
        description: remoteCfg.Description || "",
        hasInstance: !!remoteCfg.Instance,
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

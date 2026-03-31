import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { executeCommand } from "@/lib/ssh";
import {
  extractCapabilities,
  getDefaultCapabilities,
} from "@/lib/capabilities";

/**
 * Fetches capabilities for a given configId.
 *
 * Strategy: try cached JSON from local DB first (instant).
 * If no cache or ?live=true, fetch fresh from holorouter via SSH.
 */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const configId = searchParams.get("configId");
  const forceLive = searchParams.get("live") === "true";

  if (!configId || !/^[a-zA-Z0-9._-]+$/.test(configId)) {
    return NextResponse.json({ error: "Invalid configId" }, { status: 400 });
  }

  // Try cached JSON first (unless ?live=true)
  if (!forceLive) {
    const cached = await prisma.holoDeckConfig.findUnique({
      where: { configId },
    });
    if (cached?.cachedJson) {
      try {
        const configJson = JSON.parse(cached.cachedJson);
        const capabilities = extractCapabilities(configJson);
        return NextResponse.json({
          capabilities,
          source: "cache",
          lastSynced: cached.lastSynced,
          rawKeys: Object.keys(configJson),
        });
      } catch {
        // Fall through to live fetch
      }
    }
  }

  // Live fetch from holorouter
  try {
    const result = await executeCommand(
      `pwsh -NonInteractive -Command '$PSStyle.OutputRendering = "PlainText"; Import-HoloDeckConfig -ConfigID "${configId}" | Out-Null; $config | ConvertTo-Json -Depth 100'`,
      undefined,
      20000
    );

    const stdout = stripAnsi(result.stdout).trim();
    let configJson: Record<string, unknown> = {};
    try {
      configJson = JSON.parse(stdout);
    } catch {
      return NextResponse.json(
        {
          error: "Failed to parse config JSON",
          capabilities: getDefaultCapabilities(),
        },
        { status: 200 }
      );
    }

    // Update cache while we're at it
    try {
      await prisma.holoDeckConfig.upsert({
        where: { configId },
        update: { cachedJson: stdout, lastSynced: new Date() },
        create: {
          configId,
          cachedJson: stdout,
          lastSynced: new Date(),
        },
      });
    } catch {
      // Non-critical — cache update failure shouldn't break the response
    }

    const capabilities = extractCapabilities(configJson);
    return NextResponse.json({
      capabilities,
      source: "live",
      rawKeys: Object.keys(configJson),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch config",
      },
      { status: 500 }
    );
  }
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(
    /\x1b\[[\x20-\x3f]*[0-9;]*[\x20-\x7e]|\x1b\].*?(\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[>=<]|\x1b\[\?[0-9;]*[a-zA-Z]|\r/g,
    ""
  );
}

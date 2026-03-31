"use client";

import { useState, useCallback } from "react";

interface CommandPreviewProps {
  command: string;
  label?: string;
}

export function CommandPreview({ command, label = "Command Preview" }: CommandPreviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = command;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [command]);

  if (!command) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium">{label}</p>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-secondary text-secondary-foreground hover:opacity-90 transition-opacity"
        >
          {copied ? (
            <>
              <span className="text-success">&#10003;</span> Copied
            </>
          ) : (
            <>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="text-xs bg-background/50 p-3 rounded-md overflow-x-auto whitespace-pre-wrap font-mono text-muted-foreground select-all">
        {command}
      </pre>
    </div>
  );
}

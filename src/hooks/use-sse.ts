"use client";

import { useCallback, useRef, useState } from "react";

interface SSEMessage {
  type: "stdout" | "stderr" | "complete" | "error";
  data: string;
  exitCode?: number;
  duration?: number;
}

interface UseSSEResult {
  messages: SSEMessage[];
  isRunning: boolean;
  execute: (url: string, body: unknown) => void;
  clear: () => void;
}

export function useSSE(): UseSSEResult {
  const [messages, setMessages] = useState<SSEMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const execute = useCallback((url: string, body: unknown) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setMessages([]);
    setIsRunning(true);

    (async () => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json();
          setMessages((prev) => [
            ...prev,
            { type: "error", data: err.error || "Request failed" },
          ]);
          setIsRunning(false);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          setIsRunning(false);
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let eventType = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              const dataStr = line.slice(6);
              try {
                const data = JSON.parse(dataStr);
                if (eventType === "output") {
                  setMessages((prev) => [
                    ...prev,
                    { type: data.stream, data: data.line },
                  ]);
                } else if (eventType === "complete") {
                  setMessages((prev) => [
                    ...prev,
                    {
                      type: "complete",
                      data: `Command completed with exit code ${data.exitCode}`,
                      exitCode: data.exitCode,
                      duration: data.duration,
                    },
                  ]);
                } else if (eventType === "error") {
                  setMessages((prev) => [
                    ...prev,
                    { type: "error", data: data.message },
                  ]);
                }
              } catch {
                // ignore parse errors
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          setMessages((prev) => [
            ...prev,
            { type: "error", data: err.message },
          ]);
        }
      } finally {
        setIsRunning(false);
      }
    })();
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setIsRunning(false);
  }, []);

  return { messages, isRunning, execute, clear };
}

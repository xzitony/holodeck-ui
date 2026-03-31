"use client";

import { createContext, useContext, useEffect, useState } from "react";

interface UIConfig {
  ui_app_title: string;
  ui_app_subtitle: string;
  ui_logo_url: string;
  ui_color_primary: string;
  ui_color_background: string;
  ui_color_card: string;
  ui_color_sidebar: string;
}

const defaults: UIConfig = {
  ui_app_title: "Holodeck Router",
  ui_app_subtitle: "VCF 9 Management",
  ui_logo_url: "",
  ui_color_primary: "#3b82f6",
  ui_color_background: "#0a0a0a",
  ui_color_card: "#111827",
  ui_color_sidebar: "#111827",
};

const UIContext = createContext<UIConfig>(defaults);

export function useUI() {
  return useContext(UIContext);
}

function lightenHex(hex: string, amount: number): string {
  const h = hex.replace("#", "");
  const r = Math.min(255, parseInt(h.substring(0, 2), 16) + amount);
  const g = Math.min(255, parseInt(h.substring(2, 4), 16) + amount);
  const b = Math.min(255, parseInt(h.substring(4, 6), 16) + amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function hexToThemeColors(ui: UIConfig) {
  const vars: Record<string, string> = {};
  if (ui.ui_color_primary) vars["--color-primary"] = ui.ui_color_primary;
  if (ui.ui_color_background) vars["--color-background"] = ui.ui_color_background;
  if (ui.ui_color_card) {
    vars["--color-card"] = ui.ui_color_card;
    // Also update related colors that typically match card
    vars["--color-secondary"] = ui.ui_color_card;
    vars["--color-muted"] = ui.ui_color_card;
    vars["--color-accent"] = ui.ui_color_card;
    vars["--color-border"] = ui.ui_color_card;
    // Make input fields slightly lighter than the card for visibility
    vars["--color-input"] = lightenHex(ui.ui_color_card, 12);
  }
  return vars;
}

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<UIConfig>(defaults);

  useEffect(() => {
    fetch("/api/config/ui")
      .then((r) => r.json())
      .then((data) => {
        if (data.ui) {
          setConfig((prev) => ({ ...prev, ...data.ui }));
        }
      })
      .catch(() => {
        // Use defaults on error
      });
  }, []);

  useEffect(() => {
    const vars = hexToThemeColors(config);
    const root = document.documentElement;
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
  }, [config]);

  return <UIContext.Provider value={config}>{children}</UIContext.Provider>;
}

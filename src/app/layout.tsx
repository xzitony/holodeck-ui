import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/providers/auth-provider";
import { UIProvider } from "@/providers/ui-provider";

export const metadata: Metadata = {
  title: "VCF 9 Holodeck Router UI",
  description: "Web management interface for VCF Holodeck deployments",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <AuthProvider>
          <UIProvider>{children}</UIProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

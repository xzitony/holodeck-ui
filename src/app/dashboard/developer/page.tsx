"use client";

import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";

const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });

export default function DeveloperApiPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">API Documentation</h1>
        <p className="text-muted-foreground mt-1">
          Interactive API reference for the Holodeck Router UI
        </p>
      </div>
      <div className="swagger-wrapper rounded-lg overflow-hidden border border-border">
        <SwaggerUI url="/openapi.json" defaultModelsExpandDepth={-1} />
      </div>
      <style jsx global>{`
        .swagger-wrapper .swagger-ui {
          font-family: inherit;
        }
        .swagger-wrapper .swagger-ui .topbar {
          display: none;
        }
        .swagger-wrapper .swagger-ui .info {
          margin: 20px 0 10px;
        }
        .swagger-wrapper .swagger-ui .scheme-container {
          background: transparent;
          box-shadow: none;
          padding: 0 0 15px;
        }
        .swagger-wrapper .swagger-ui .opblock-tag {
          border-bottom-color: hsl(var(--border));
        }
        .swagger-wrapper .swagger-ui,
        .swagger-wrapper .swagger-ui .info .title,
        .swagger-wrapper .swagger-ui .info .description p,
        .swagger-wrapper .swagger-ui .opblock-tag,
        .swagger-wrapper .swagger-ui .opblock .opblock-summary-description,
        .swagger-wrapper .swagger-ui .opblock-description-wrapper p,
        .swagger-wrapper .swagger-ui table thead tr th,
        .swagger-wrapper .swagger-ui table tbody tr td,
        .swagger-wrapper .swagger-ui .parameter__name,
        .swagger-wrapper .swagger-ui .parameter__type,
        .swagger-wrapper .swagger-ui .response-col_status,
        .swagger-wrapper .swagger-ui .response-col_description,
        .swagger-wrapper .swagger-ui .response-col_links,
        .swagger-wrapper .swagger-ui .model-title,
        .swagger-wrapper .swagger-ui .model {
          color: hsl(var(--foreground));
        }
        .swagger-wrapper .swagger-ui .opblock .opblock-section-header {
          background: hsl(var(--card));
        }
        .swagger-wrapper .swagger-ui .opblock .opblock-section-header h4 {
          color: hsl(var(--foreground));
        }
        .swagger-wrapper .swagger-ui input[type=text],
        .swagger-wrapper .swagger-ui textarea,
        .swagger-wrapper .swagger-ui select {
          background: hsl(var(--input));
          color: hsl(var(--foreground));
          border-color: hsl(var(--border));
        }
        .swagger-wrapper .swagger-ui .btn {
          color: hsl(var(--foreground));
          border-color: hsl(var(--border));
        }
      `}</style>
    </div>
  );
}

declare module "swagger-ui-react" {
  import { ComponentType } from "react";
  interface SwaggerUIProps {
    url?: string;
    spec?: object;
    defaultModelsExpandDepth?: number;
    defaultModelExpandDepth?: number;
    docExpansion?: "list" | "full" | "none";
    [key: string]: unknown;
  }
  const SwaggerUI: ComponentType<SwaggerUIProps>;
  export default SwaggerUI;
}

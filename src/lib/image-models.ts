import { SEEDREAM_NAME } from "./branding";

export const DEFAULT_SEEDREAM_MODEL = "dola-seedream-5-5-261028";

export function seedreamModelLabel(model?: string | null) {
  if (!model || model === DEFAULT_SEEDREAM_MODEL) return SEEDREAM_NAME;
  if (model === "dola-seedream-5-0-pro-260628") return "Seedream 5.0 Pro";
  return model;
}

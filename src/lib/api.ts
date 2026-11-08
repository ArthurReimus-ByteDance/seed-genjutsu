import { z } from "zod";
import { http, createHttpClient } from "./http";
import type { AxiosInstance } from "axios";
import {
  enhancePromptRequestSchema,
  promptEnhancementSchema,
  type EnhancePromptRequest,
} from "./prompt-enhancement";
import {
  capabilitySchema,
  createJobSchema,
  jobSchema,
  uploadSchema,
  type CreateJob,
} from "./schemas";
export const studioQueryKeys = (mode: "live" | "demo") => ({
  capabilities: ["studio", mode, "capabilities"] as const,
  jobs: ["studio", mode, "jobs"] as const,
  job: (id: string) => ["studio", mode, "job", id] as const,
});
export const queryKeys = studioQueryKeys("live");
type ReadOptions = { signal?: AbortSignal };
export type DemoScenario = "success" | "failure";
export const createStudioApi = (http: AxiosInstance) => ({
  enhancePrompt: async (
    input: EnhancePromptRequest,
    options?: { signal?: AbortSignal; scenario?: DemoScenario },
  ) =>
    z.object({ enhancement: promptEnhancementSchema }).parse(
      (
        await http.post(
          "/prompts/enhance",
          enhancePromptRequestSchema.parse(input),
          {
            signal: options?.signal,
            headers: options?.scenario
              ? { "X-Recast-Scenario": options.scenario }
              : undefined,
          },
        )
      ).data,
    ).enhancement,
  capabilities: async (options?: ReadOptions) =>
    capabilitySchema.parse(
      (await http.get("/capabilities", { signal: options?.signal })).data,
    ),
  jobs: async (options?: ReadOptions) =>
    z
      .object({ jobs: z.array(jobSchema) })
      .parse((await http.get("/jobs", { signal: options?.signal })).data).jobs,
  job: async (id: string, signal?: AbortSignal) =>
    z
      .object({ job: jobSchema })
      .parse((await http.get("/jobs/" + id, { signal })).data).job,
  create: async (input: CreateJob, scenario?: DemoScenario) =>
    z.object({ job: jobSchema }).parse(
      (
        await http.post("/jobs", createJobSchema.parse(input), {
          headers: scenario ? { "X-Recast-Scenario": scenario } : undefined,
        })
      ).data,
    ).job,
  approve: async (id: string) =>
    z
      .object({ job: jobSchema })
      .parse((await http.post("/jobs/" + id + "/approve")).data).job,
  cancel: async (id: string) =>
    z
      .object({ job: jobSchema })
      .parse((await http.post("/jobs/" + id + "/cancel")).data).job,
  upload: async (
    file: File,
    kind: "video" | "character",
    progress: (value: number) => void,
    signal?: AbortSignal,
  ) => {
    const form = new FormData();
    form.set("file", file);
    form.set("kind", kind);
    return z.object({ upload: uploadSchema }).parse(
      (
        await http.post("/uploads", form, {
          signal,
          onUploadProgress: (e) =>
            progress(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
        })
      ).data,
    ).upload;
  },
});
export const api = createStudioApi(http);
const mockHttp = createHttpClient("/api/demo");
export const demoApi = {
  ...createStudioApi(mockHttp),
  samples: async () =>
    z
      .object({ source: uploadSchema, character: uploadSchema })
      .parse((await mockHttp.post("/samples")).data),
};
export type StudioApi = typeof api;

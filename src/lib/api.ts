import { z } from "zod";
import { http } from "./http";
import {
  capabilitySchema,
  createJobSchema,
  jobSchema,
  uploadSchema,
  userSchema,
  type CreateJob,
} from "./schemas";
export const queryKeys = {
  session: ["session"] as const,
  capabilities: ["capabilities"] as const,
  jobs: ["jobs"] as const,
  job: (id: string) => ["job", id] as const,
};
type ReadOptions = { signal?: AbortSignal };
const authResponse = z.object({ user: userSchema });
export const api = {
  session: async (options?: ReadOptions) =>
    z
      .object({ user: userSchema.nullable(), registration: z.boolean() })
      .parse(
        (await http.get("/auth/session", { signal: options?.signal })).data,
      ),
  login: async (input: { email: string; password: string }) =>
    authResponse.parse(
      (
        await http.post("/auth/login", {
          email: input.email,
          password: input.password,
        })
      ).data,
    ),
  register: async (input: {
    email: string;
    password: string;
    name?: string;
    inviteCode?: string;
  }) => authResponse.parse((await http.post("/auth/register", input)).data),
  logout: async () => {
    await http.post("/auth/logout");
  },
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
  create: async (input: CreateJob) =>
    z
      .object({ job: jobSchema })
      .parse((await http.post("/jobs", createJobSchema.parse(input))).data).job,
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
};

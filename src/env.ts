import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { videoModels } from "./lib/video-models";
import { DEFAULT_SAM_VERIFIER_MODEL } from "./lib/sam-verification";

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    APP_URL: z
      .url()
      .refine(
        (value) =>
          ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname),
        "The single-user studio must use a loopback APP_URL.",
      )
      .default("http://localhost:3107"),
    DEMO_ENABLED: z.enum(["true", "false"]).default("false"),
    BYTEPLUS_API_KEY: z.string().optional(),
    PROMPT_ENHANCER_MODEL: z
      .string()
      .min(1)
      .default("deepseek-v4-1-flash-261017"),
    BYTEPLUS_BASE_URL: z
      .url()
      .default("https://ark.ap-southeast.bytepluses.com/api/v3"),
    BYTEPLUS_ACCESS_KEY: z.string().optional(),
    BYTEPLUS_SECRET_KEY: z.string().optional(),
    BYTEPLUS_SESSION_TOKEN: z.string().optional(),
    BYTEPLUS_REGION: z.string().default("ap-southeast-1"),
    BYTEPLUS_PROJECT: z.string().default("default"),
    BYTEPLUS_ASSET_GROUP: z.string().optional(),
    SEEDANCE_2_MODEL: z.string().default(videoModels["seedance-2"].providerId),
    SEEDANCE_2_5_MODEL: z
      .string()
      .default(videoModels["seedance-2.5"].providerId),
    SEEDREAM_MODEL: z.string().optional(),
    META_API_KEY: z.string().optional(),
    SAM_VERIFIER_MODEL: z.string().min(1).default(DEFAULT_SAM_VERIFIER_MODEL),
    SAM_VERIFIER_FPS: z.coerce.number().min(0.2).max(5).default(2),
    STORAGE_MODE: z.enum(["local", "tos"]).default("local"),
    TOS_BUCKET: z.string().optional(),
    TOS_REGION: z.string().default("ap-southeast-1"),
    TOS_ENDPOINT: z.string().default("tos-ap-southeast-1.bytepluses.com"),
    MEDIA_ROOT: z.string().default(".data"),
    WORKER_POLL_MS: z.coerce.number().min(500).default(2000),
    MAX_DAILY_JOBS: z.coerce.number().int().positive().default(20),
    MAX_ACTIVE_JOBS: z.coerce.number().int().positive().default(2),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DEMO_ENABLED: process.env.DEMO_ENABLED,
    APP_URL: process.env.APP_URL,
    BYTEPLUS_API_KEY: process.env.BYTEPLUS_API_KEY,
    PROMPT_ENHANCER_MODEL: process.env.PROMPT_ENHANCER_MODEL,
    BYTEPLUS_BASE_URL: process.env.BYTEPLUS_BASE_URL,
    BYTEPLUS_ACCESS_KEY: process.env.BYTEPLUS_ACCESS_KEY,
    BYTEPLUS_SECRET_KEY: process.env.BYTEPLUS_SECRET_KEY,
    BYTEPLUS_SESSION_TOKEN: process.env.BYTEPLUS_SESSION_TOKEN,
    BYTEPLUS_REGION: process.env.BYTEPLUS_REGION,
    BYTEPLUS_PROJECT: process.env.BYTEPLUS_PROJECT,
    BYTEPLUS_ASSET_GROUP: process.env.BYTEPLUS_ASSET_GROUP,
    SEEDANCE_2_MODEL: process.env.SEEDANCE_2_MODEL,
    SEEDANCE_2_5_MODEL: process.env.SEEDANCE_2_5_MODEL,
    SEEDREAM_MODEL: process.env.SEEDREAM_MODEL,
    META_API_KEY: process.env.META_API_KEY,
    SAM_VERIFIER_MODEL: process.env.SAM_VERIFIER_MODEL,
    SAM_VERIFIER_FPS: process.env.SAM_VERIFIER_FPS,
    STORAGE_MODE: process.env.STORAGE_MODE,
    TOS_BUCKET: process.env.TOS_BUCKET,
    TOS_REGION: process.env.TOS_REGION,
    TOS_ENDPOINT: process.env.TOS_ENDPOINT,
    MEDIA_ROOT: process.env.MEDIA_ROOT,
    WORKER_POLL_MS: process.env.WORKER_POLL_MS,
    MAX_DAILY_JOBS: process.env.MAX_DAILY_JOBS,
    MAX_ACTIVE_JOBS: process.env.MAX_ACTIVE_JOBS,
  },
  emptyStringAsUndefined: true,
});

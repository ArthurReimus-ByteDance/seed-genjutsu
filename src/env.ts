import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z
      .string()
      .default("postgresql://recast:recast@127.0.0.1:58432/recast"),
    APP_URL: z.url().default("http://localhost:3107"),
    SESSION_SECRET: z.string().min(32).optional(),
    REGISTRATION_ENABLED: z.enum(["true", "false"]).default("false"),
    INVITE_CODE: z.string().optional(),
    BYTEPLUS_API_KEY: z.string().optional(),
    BYTEPLUS_BASE_URL: z
      .url()
      .default("https://ark.ap-southeast.bytepluses.com/api/v3"),
    BYTEPLUS_ACCESS_KEY: z.string().optional(),
    BYTEPLUS_SECRET_KEY: z.string().optional(),
    BYTEPLUS_SESSION_TOKEN: z.string().optional(),
    BYTEPLUS_REGION: z.string().default("ap-southeast-1"),
    BYTEPLUS_PROJECT: z.string().default("default"),
    BYTEPLUS_ASSET_GROUP: z.string().optional(),
    SEEDANCE_MODEL: z.string().default("dreamina-seedance-2-5-260628"),
    SEEDREAM_MODEL: z.string().optional(),
    FAL_KEY: z.string().optional(),
    FAL_SAM_ENDPOINT: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_/-]+$/)
      .default("fal-ai/sam-3-1/video"),
    STORAGE_MODE: z.enum(["local", "tos"]).default("local"),
    TOS_ACCESS_KEY: z.string().optional(),
    TOS_SECRET_KEY: z.string().optional(),
    TOS_BUCKET: z.string().optional(),
    TOS_REGION: z.string().default("ap-southeast-1"),
    TOS_ENDPOINT: z.string().default("tos-ap-southeast-1.bytepluses.com"),
    TOS_SESSION_TOKEN: z.string().optional(),
    MEDIA_ROOT: z.string().default(".data"),
    WORKER_POLL_MS: z.coerce.number().min(500).default(2000),
    MAX_DAILY_JOBS: z.coerce.number().int().positive().default(20),
    MAX_ACTIVE_JOBS: z.coerce.number().int().positive().default(2),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    APP_URL: process.env.APP_URL,
    SESSION_SECRET: process.env.SESSION_SECRET,
    REGISTRATION_ENABLED: process.env.REGISTRATION_ENABLED,
    INVITE_CODE: process.env.INVITE_CODE,
    BYTEPLUS_API_KEY: process.env.BYTEPLUS_API_KEY,
    BYTEPLUS_BASE_URL: process.env.BYTEPLUS_BASE_URL,
    BYTEPLUS_ACCESS_KEY: process.env.BYTEPLUS_ACCESS_KEY,
    BYTEPLUS_SECRET_KEY: process.env.BYTEPLUS_SECRET_KEY,
    BYTEPLUS_SESSION_TOKEN: process.env.BYTEPLUS_SESSION_TOKEN,
    BYTEPLUS_REGION: process.env.BYTEPLUS_REGION,
    BYTEPLUS_PROJECT: process.env.BYTEPLUS_PROJECT,
    BYTEPLUS_ASSET_GROUP: process.env.BYTEPLUS_ASSET_GROUP,
    SEEDANCE_MODEL: process.env.SEEDANCE_MODEL,
    SEEDREAM_MODEL: process.env.SEEDREAM_MODEL,
    FAL_KEY: process.env.FAL_KEY,
    FAL_SAM_ENDPOINT: process.env.FAL_SAM_ENDPOINT,
    STORAGE_MODE: process.env.STORAGE_MODE,
    TOS_ACCESS_KEY: process.env.TOS_ACCESS_KEY,
    TOS_SECRET_KEY: process.env.TOS_SECRET_KEY,
    TOS_BUCKET: process.env.TOS_BUCKET,
    TOS_REGION: process.env.TOS_REGION,
    TOS_ENDPOINT: process.env.TOS_ENDPOINT,
    TOS_SESSION_TOKEN: process.env.TOS_SESSION_TOKEN,
    MEDIA_ROOT: process.env.MEDIA_ROOT,
    WORKER_POLL_MS: process.env.WORKER_POLL_MS,
    MAX_DAILY_JOBS: process.env.MAX_DAILY_JOBS,
    MAX_ACTIVE_JOBS: process.env.MAX_ACTIVE_JOBS,
  },
  emptyStringAsUndefined: true,
});

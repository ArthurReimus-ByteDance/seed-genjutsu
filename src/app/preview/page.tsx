import { StudioLoading } from "@/components/studio/loading";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { env } from "@/env";
import { Studio } from "@/components/studio";
export const dynamic = "force-dynamic";
export default function Preview() {
  if (env.DEMO_ENABLED !== "true") notFound();
  return (
    <Suspense fallback={<StudioLoading />}>
      <Studio mode="demo" demoAvailable />
    </Suspense>
  );
}

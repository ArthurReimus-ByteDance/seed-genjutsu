import { StudioLoading } from "@/components/studio/loading";
import { Suspense } from "react";
import { env } from "@/env";
import { Studio } from "@/components/studio";
export const dynamic = "force-dynamic";
export default function Page() {
  return (
    <Suspense fallback={<StudioLoading />}>
      <Studio demoAvailable={env.DEMO_ENABLED === "true"} />
    </Suspense>
  );
}

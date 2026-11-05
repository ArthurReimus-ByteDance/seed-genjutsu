import { Suspense } from "react";
import { Studio } from "@/components/studio";
export default function Page() {
  return (
    <Suspense fallback={<div className="boot">Opening your studio…</div>}>
      <Studio />
    </Suspense>
  );
}

import { APP_NAME } from "@/lib/branding";
import { BytePlusMark } from "./byteplus-mark";

export function StudioLoading() {
  return (
    <div
      className="studio-loading"
      role="status"
      aria-label="Opening your studio"
    >
      <div className="loading-brand">
        <span className="wordmark">
          <BytePlusMark />
          <span>{APP_NAME}</span>
        </span>
      </div>
      <div className="loading-layout">
        <div className="loading-controls">
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="loading-canvas">
          <span />
          <p>Opening your workspace…</p>
        </div>
      </div>
    </div>
  );
}

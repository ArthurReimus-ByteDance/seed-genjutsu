"use client";
import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Film, ImagePlus, Upload, Loader2, X, Check } from "lucide-react";
import { toast } from "sonner";
import { api, type StudioApi } from "@/lib/api";
import type { Upload as Media } from "@/lib/schemas";
export function UploadTile({
  kind,
  value,
  onChange,
  disabled,
  apiClient = api,
  onBusyChange,
  label,
}: {
  kind: "video" | "character";
  value: Media | null;
  onChange: (media: Media | null) => void;
  disabled?: boolean;
  apiClient?: StudioApi;
  onBusyChange?: (busy: boolean) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  const current = useRef({ disabled, onChange, onBusyChange });
  useLayoutEffect(() => {
    current.current = { disabled, onChange, onBusyChange };
  });
  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
      current.current.onBusyChange?.(false);
    },
    [],
  );
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [drag, setDrag] = useState(false);
  async function upload(file?: File) {
    if (!file) return;
    if (disabled || loading) return;
    if (file.size > (kind === "video" ? 100 : 20) * 1024 * 1024) {
      toast.error(
        kind === "video"
          ? "Videos must be under 100 MB."
          : "Images must be under 20 MB.",
      );
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    const signal = controller.signal;
    onBusyChange?.(true);
    setLoading(true);
    setProgress(0);
    try {
      const media = await apiClient.upload(file, kind, setProgress, signal);
      if (signal.aborted || current.current.disabled) return;
      current.current.onChange(media);
      toast.success(
        kind === "video"
          ? "Your performance is ready."
          : label
            ? "Reference added."
            : "Character added.",
      );
    } catch (e) {
      if (!signal.aborted)
        toast.error(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        current.current.onBusyChange?.(false);
        setLoading(false);
        if (input.current) input.current.value = "";
      }
    }
  }
  return (
    <div
      aria-busy={loading}
      className={"upload-wrap " + (drag ? "is-dragging" : "")}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        void upload(e.dataTransfer.files[0]);
      }}
    >
      <input
        ref={input}
        data-testid={kind + "-upload"}
        aria-label={
          label
            ? "Upload " + label.toLowerCase()
            : kind === "video"
              ? "Upload source video"
              : "Upload character image"
        }
        type="file"
        accept={
          kind === "video"
            ? "video/mp4,video/quicktime"
            : "image/jpeg,image/png,image/webp"
        }
        className="sr-only"
        disabled={disabled || loading}
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      <button
        type="button"
        className={"upload-tile " + (value ? "has-media" : "")}
        disabled={disabled || loading}
        onClick={() => input.current?.click()}
        aria-label={
          label
            ? "Choose " + label.toLowerCase()
            : kind === "video"
              ? "Choose source video"
              : "Choose character image"
        }
      >
        {value ? (
          <>
            <Image
              src={value.posterUrl ?? value.url}
              alt={
                kind === "video"
                  ? "Your source performance"
                  : "Your character reference"
              }
              className="upload-preview"
              fill
              unoptimized
              sizes="(max-width: 900px) 50vw, 160px"
            />
            <span className="upload-shade" />
            <span className="upload-replace">
              <Upload size={16} />
              Replace
            </span>
            <span className="upload-ready">
              <Check size={10} />
            </span>
          </>
        ) : (
          <>
            <span className="upload-icon">
              {kind === "video" ? (
                <Film size={21} strokeWidth={1.5} />
              ) : (
                <ImagePlus size={21} strokeWidth={1.5} />
              )}
            </span>
            <span className="upload-title">
              {label ?? (kind === "video" ? "Source video" : "Your character")}
            </span>
            <span className="upload-hint">
              {kind === "video"
                ? "Drop your performance"
                : "Drop a reference image"}
            </span>
            <span className="upload-format">
              {kind === "video" ? "MP4, MOV · 100 MB" : "JPG, PNG, WebP"}
            </span>
          </>
        )}
        {loading && (
          <span className="upload-loading">
            <Loader2 className="animate-spin" size={23} />
            <span>
              {progress < 100
                ? "Uploading " + progress + "%"
                : "Preparing media…"}
            </span>
          </span>
        )}
      </button>
      {value && !disabled && !loading && (
        <button
          type="button"
          className="upload-remove"
          onClick={() => onChange(null)}
          aria-label={"Remove " + kind}
        >
          <X size={12} />
        </button>
      )}
      <div className="upload-caption">
        {value ? (
          <>
            <span title={value.name}>{value.name}</span>
            <span>
              {kind === "video"
                ? Number(value.duration).toFixed(1) + "s"
                : value.width + " × " + value.height}
            </span>
          </>
        ) : (
          <span>
            {kind === "video" ? "01 / THE PERFORMANCE" : "02 / THE APPEARANCE"}
          </span>
        )}
      </div>
    </div>
  );
}

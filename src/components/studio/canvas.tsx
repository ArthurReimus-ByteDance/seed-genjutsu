"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowDownToLine,
  Check,
  Columns2,
  Film,
  Loader2,
  Pause,
  Play,
  ScanFace,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Job, Upload } from "@/lib/schemas";

export const statusNames: Record<Job["status"], string> = {
  queued: "Queued",
  processing: "Preparing",
  awaiting_approval: "Review ready",
  generating: "Creating",
  succeeded: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
  needs_attention: "Needs attention",
};
export function StatusBadge({ job }: { job: Job }) {
  return (
    <span className={cn("take-status", job.status)}>
      {["queued", "processing", "generating"].includes(job.status) ? (
        <Loader2 size={12} className="animate-spin" />
      ) : job.status === "succeeded" ? (
        <Check size={12} />
      ) : (
        <span />
      )}
      {statusNames[job.status]}
    </span>
  );
}
export function ExampleCanvas({
  onSample,
  samplePending,
  sampleDisabled = false,
  canTry,
}: {
  onSample: () => void;
  samplePending: boolean;
  sampleDisabled?: boolean;
  canTry: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const a = useRef<HTMLVideoElement>(null),
    b = useRef<HTMLVideoElement>(null);
  async function toggle() {
    if (playing) {
      a.current?.pause();
      b.current?.pause();
      setPlaying(false);
    } else {
      try {
        if (a.current && b.current) {
          a.current.currentTime = 0;
          b.current.currentTime = 0;
          await Promise.all([a.current.play(), b.current.play()]);
          setPlaying(true);
        }
      } catch {
        setPlaying(false);
      }
    }
  }
  return (
    <section className="example-block">
      <div className="example-compare">
        <div className="example-half">
          <Image
            src="/samples/source.jpg"
            alt="Fictional source performer in a sunlit gallery"
            fill
            sizes="(max-width:900px) 50vw, 35vw"
            priority
          />
          <video
            ref={a}
            src="/samples/source.mp4"
            className={cn("example-motion", !playing && "not-playing")}
            muted
            loop
            playsInline
            preload="none"
            aria-hidden="true"
          />
        </div>
        <div className="example-half">
          <Image
            src="/samples/character.jpg"
            alt="Illustrative android character in the same gallery"
            fill
            sizes="(max-width:900px) 50vw, 35vw"
            priority
          />
          <video
            ref={b}
            src="/samples/result.mp4"
            className={cn("example-motion", !playing && "not-playing")}
            muted
            loop
            playsInline
            preload="none"
            aria-hidden="true"
          />
        </div>
        <div className="example-label left">
          <span />
          Original
        </div>
        <div className="example-label right">
          <Sparkles size={12} />
          New character
        </div>
        <div className="example-direction">
          <ArrowRight size={17} />
        </div>
        <div className="example-bottom">
          <button
            onClick={() => void toggle()}
            aria-label={playing ? "Pause sample video" : "Play sample video"}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
            <span>
              {playing ? "Pause" : "Play sample"}
              <i>0:06</i>
            </span>
          </button>
        </div>
      </div>
      {canTry && (
        <div className="example-actions">
          <Button
            onClick={onSample}
            disabled={samplePending || sampleDisabled}
            className="try-sample"
          >
            {samplePending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Sparkles size={15} />
            )}
            Try sample
            <ArrowRight size={15} />
          </Button>
        </div>
      )}
    </section>
  );
}
function ClipVideo({
  media,
  start = 0,
  duration,
  label = "Performance preview",
}: {
  media: Upload;
  start?: number;
  duration?: number;
  label?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (video && video.readyState >= 1) video.currentTime = start;
  }, [media.id, start]);
  return (
    <video
      ref={ref}
      src={media.url}
      poster={media.posterUrl ?? undefined}
      controls
      playsInline
      preload="metadata"
      aria-label={label}
      onLoadedMetadata={(e) => {
        e.currentTarget.currentTime = start;
      }}
      onPlay={(e) => {
        const v = e.currentTarget;
        if (
          duration &&
          (v.currentTime < start || v.currentTime >= start + duration)
        )
          v.currentTime = start;
      }}
      onTimeUpdate={(e) => {
        const v = e.currentTarget;
        if (duration && v.currentTime >= start + duration) {
          v.pause();
          v.currentTime = start;
        }
      }}
    />
  );
}
function SyncedCompare({ job }: { job: Job }) {
  const original = useRef<HTMLVideoElement>(null),
    result = useRef<HTMLVideoElement>(null);
  function seek() {
    if (original.current && result.current)
      original.current.currentTime =
        job.config.start + result.current.currentTime;
  }
  return (
    <div className="synced-compare">
      <div>
        <span className="media-label">Original</span>
        <video
          ref={original}
          src={job.source.url}
          poster={job.source.posterUrl ?? undefined}
          muted
          playsInline
          preload="metadata"
          aria-label="Original comparison"
          onLoadedMetadata={seek}
        />
      </div>
      <div>
        <span className="media-label">Your take</span>
        <video
          ref={result}
          src={job.result!.url}
          poster={job.result!.posterUrl ?? job.anchor?.url ?? undefined}
          controls
          playsInline
          preload="metadata"
          aria-label="Result comparison"
          onPlay={() => {
            seek();
            void original.current?.play().catch(() => {});
          }}
          onPause={() => original.current?.pause()}
          onSeeked={seek}
          onEnded={() => original.current?.pause()}
          onTimeUpdate={() => {
            if (
              original.current &&
              result.current &&
              Math.abs(
                original.current.currentTime -
                  job.config.start -
                  result.current.currentTime,
              ) > 0.08
            )
              seek();
          }}
          onRateChange={() => {
            if (original.current && result.current)
              original.current.playbackRate = result.current.playbackRate;
          }}
        />
      </div>
      <p>
        <Columns2 size={13} />
        Play the result to compare both clips in sync.
      </p>
    </div>
  );
}
export function JobStepper({ job }: { job: Job }) {
  const index =
    job.status === "succeeded"
      ? 3
      : job.status === "awaiting_approval" || job.stage === "review"
        ? 1
        : ["registering", "asset_review", "submitting", "generating"].includes(
              job.stage,
            )
          ? 2
          : 0;
  const steps = ["Prepare", "Review", "Create", "Ready"];
  return (
    <ol className="job-stepper" aria-label="Generation stages">
      {steps.map((label, i) => (
        <li
          key={label}
          className={cn(i < index && "done", i === index && "current")}
          aria-current={i === index ? "step" : undefined}
        >
          <span>{i < index ? <Check size={12} /> : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
export function MediaCanvas({
  source,
  job,
  start,
  duration,
  tab,
  onTab,
}: {
  source: Upload;
  job?: Job | null;
  start: number;
  duration: number;
  tab: string | null;
  onTab: (tab: string) => void;
}) {
  const chosen =
    tab ??
    (job?.result
      ? "result"
      : job?.status === "awaiting_approval"
        ? job.anchor
          ? "anchor"
          : "masked"
        : "source");
  const selected =
    chosen === "result" || chosen === "compare"
      ? job?.result
      : chosen === "anchor"
        ? job?.anchor
        : chosen === "masked"
          ? job?.masked
          : source;
  const busy =
    job && ["queued", "processing", "generating"].includes(job.status);
  const displayedDuration =
    chosen === "result" || chosen === "compare"
      ? (job?.result?.duration ?? duration)
      : duration;
  return (
    <section className="preview-card">
      <div className="preview-toolbar">
        <div className="preview-tabs" role="tablist" aria-label="Preview media">
          {[
            { id: "source", label: "Original", media: source },
            { id: "masked", label: "Subject", media: job?.masked },
            { id: "anchor", label: "Scene look", media: job?.anchor },
            { id: "result", label: "Result", media: job?.result },
            { id: "compare", label: "Compare", media: job?.result },
          ]
            .filter((t) => t.media)
            .map((t) => (
              <button
                role="tab"
                aria-selected={chosen === t.id}
                key={t.id}
                onClick={() => onTab(t.id)}
              >
                {t.id === "compare" && <Columns2 size={13} />} {t.label}
              </button>
            ))}
        </div>
        {job ? (
          <StatusBadge job={job} />
        ) : (
          <span className="draft-label">Input preview</span>
        )}
      </div>
      {chosen === "compare" && job?.result ? (
        <SyncedCompare job={job} />
      ) : (
        <div
          className="video-stage"
          style={{
            aspectRatio:
              (selected?.width ?? source.width) /
              (selected?.height ?? source.height),
          }}
        >
          {selected?.mime.startsWith("video") ? (
            <ClipVideo
              key={selected.id}
              media={selected}
              start={chosen === "source" ? start : 0}
              duration={chosen === "result" ? undefined : duration}
              label={
                chosen === "result"
                  ? "Result preview"
                  : chosen === "masked"
                    ? "Subject preview"
                    : "Performance preview"
              }
            />
          ) : selected ? (
            <Image
              src={selected.url}
              alt="Prepared scene look for review"
              width={selected.width}
              height={selected.height}
              unoptimized
            />
          ) : (
            <div className="media-loading">
              <Loader2 className="animate-spin" />
              <span>Loading your reference…</span>
            </div>
          )}
          {busy && (
            <div className="processing-tag" role="status">
              <span className="scan-orb">
                <ScanFace size={17} />
              </span>
              <div>
                <strong>
                  {job.stage === "registering"
                    ? "Registering your reference"
                    : job.stage === "asset_review"
                      ? "Checking your reference"
                      : job.stage === "submitting"
                        ? "Starting video generation"
                        : job.stage === "image_preparation"
                          ? "Preparing the scene look"
                          : job.status === "generating"
                            ? "Creating your take"
                            : "Preparing your references"}
                </strong>
                <span>This take is saved. You can come back anytime.</span>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="preview-metadata">
        <span>
          <Film size={13} />
          {selected?.width ?? source.width} ×{" "}
          {selected?.height ?? source.height}
          <i />
          {displayedDuration.toFixed(1)} seconds
        </span>
        <span>
          {job?.result && chosen === "result"
            ? "Ready to review"
            : chosen === "compare"
              ? "Synchronized comparison"
              : chosen === "anchor"
                ? "Appearance reference"
                : "Performance reference"}
        </span>
      </div>
      {busy && (
        <div
          className="canvas-progress"
          role="progressbar"
          aria-label="Generation progress"
          aria-valuenow={job.progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: job.progress + "%" }} />
        </div>
      )}
    </section>
  );
}
export function RunDetails({
  job,
  onApprove,
  onReuse,
  onCancel,
  approving,
  cancelling,
  reuseDisabled,
}: {
  job: Job;
  onApprove: () => void;
  onReuse: () => void;
  onCancel: () => void;
  approving: boolean;
  cancelling: boolean;
  reuseDisabled: boolean;
}) {
  const [activity, setActivity] = useState(false);
  const review = job.status === "awaiting_approval";
  const uncertain = job.status === "needs_attention";
  const failed = job.status === "failed" || uncertain;
  const done = job.status === "succeeded";
  return (
    <section
      className={cn(
        "run-card",
        review && "review-ready",
        failed && "run-failed",
      )}
    >
      <JobStepper job={job} />
      <div className="run-main">
        {!done && (
          <div>
            <h3>
              {review
                ? "Your references are ready."
                : failed
                  ? uncertain
                    ? "Check this take before retrying."
                    : "Retry this take"
                  : job.status === "cancelled"
                    ? "Take cancelled."
                    : "Processing take"}
            </h3>
            <p>
              {review
                ? "Check the subject mask and preserved scene" +
                  (job.anchor ? " and prepared scene look" : "") +
                  ", then approve to create your video."
                : failed
                  ? uncertain
                    ? "The provider submission wasn’t confirmed. Check for an existing provider task before creating another."
                    : "Your references and direction are saved. You can edit them for a new take."
                  : job.status === "cancelled"
                    ? "Your references are still here whenever you’re ready."
                    : "Reopen this take from Your takes."}
            </p>
          </div>
        )}
        <div className="run-actions">
          {review ? (
            <>
              <Button onClick={onApprove} disabled={approving || cancelling}>
                {approving ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  <Check size={14} />
                )}
                Approve & create video
              </Button>
              <button
                className="cancel-review"
                onClick={onCancel}
                disabled={cancelling}
              >
                {cancelling ? "Cancelling…" : "Cancel take"}
              </button>
            </>
          ) : done ? (
            <>
              <Button asChild>
                <a
                  href={job.result!.url + "?download=1"}
                  download={job.result!.name}
                >
                  <ArrowDownToLine size={15} />
                  Download video
                </a>
              </Button>
              <Button
                variant="ghost"
                onClick={onReuse}
                disabled={reuseDisabled}
              >
                <Sparkles size={14} />
                Create a variation
              </Button>
            </>
          ) : failed || job.status === "cancelled" ? (
            <Button
              variant="outline"
              onClick={onReuse}
              disabled={reuseDisabled}
            >
              Edit & try again
              <ArrowRight size={14} />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={onCancel}
              disabled={cancelling}
            >
              {cancelling ? (
                <Loader2 size={13} className="animate-spin" />
              ) : null}
              Cancel take
            </Button>
          )}
        </div>
      </div>
      {job.error && (
        <div className="run-error" role="alert">
          {job.error}
        </div>
      )}
      <button
        className="activity-toggle"
        onClick={() => setActivity(!activity)}
        aria-expanded={activity}
      >
        {activity ? "Hide activity" : "View activity"}
        <span>{job.events.length} updates</span>
      </button>
      {activity && (
        <ol className="activity-list">
          {job.events.map((event) => (
            <li key={event.id}>
              <span />
              <p>{event.message}</p>
              <time>
                {new Date(event.createdAt).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

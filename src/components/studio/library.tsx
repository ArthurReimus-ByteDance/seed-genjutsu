"use client";
import Image from "next/image";
import { useState } from "react";
import { ArrowRight, Film, Layers3, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "./canvas";
import type { Job } from "@/lib/schemas";
import { videoModels } from "@/lib/video-models";
import { effectiveDirection, workflows, stylePresets } from "@/lib/workflows";
export function Library({
  jobs,
  loading,
  error,
  onRetry,
  onSelect,
  onNew,
  newDisabled = false,
}: {
  jobs: Job[];
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onSelect: (job: Job) => void;
  onNew: () => void;
  newDisabled?: boolean;
}) {
  const [filter, setFilter] = useState("all"),
    [search, setSearch] = useState("");
  const visible = jobs.filter(
    (job) =>
      (filter === "all" ||
        (filter === "ready" && job.status === "succeeded") ||
        (filter === "attention" &&
          ["failed", "needs_attention", "awaiting_approval"].includes(
            job.status,
          ))) &&
      [
        job.name,
        workflows[job.config.workflow].label,
        effectiveDirection(job.config),
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <section className="library-view">
      <div className="library-tools">
        <div className="library-filters" role="group" aria-label="Filter takes">
          {[
            ["all", "All takes"],
            ["ready", "Ready"],
            ["attention", "Needs attention"],
          ].map(([key, label]) => (
            <button
              key={key}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="search-takes">
          <Search size={14} />
          <Input
            aria-label="Search takes"
            value={search}
            placeholder="Search your takes…"
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button aria-label="Clear search" onClick={() => setSearch("")}>
              <X size={12} />
            </button>
          )}
        </label>
      </div>
      {error ? (
        <div className="empty-library" role="alert">
          <h3>Your library couldn’t load.</h3>
          <p>{error}</p>
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : loading ? (
        <div
          className="library-skeleton"
          role="status"
          aria-label="Loading takes"
        >
          <div />
          <div />
          <div />
        </div>
      ) : visible.length ? (
        <>
          <p className="library-count">
            {visible.length} {visible.length === 1 ? "take" : "takes"}
          </p>
          <div className="library-grid">
            {visible.map((job) => {
              const poster =
                job.result?.posterUrl ??
                job.anchor?.url ??
                job.prepared?.posterUrl ??
                job.frame?.url ??
                job.source.posterUrl ??
                job.character?.url ??
                job.references[0]?.media.url;
              return (
                <button
                  className="take-card"
                  key={job.id}
                  onClick={() => onSelect(job)}
                >
                  <div className="take-poster">
                    {poster ? (
                      <Image
                        src={poster}
                        alt=""
                        fill
                        unoptimized
                        sizes="(max-width: 900px) 50vw, 280px"
                      />
                    ) : (
                      <Film
                        className="take-no-poster"
                        size={32}
                        aria-hidden="true"
                      />
                    )}
                    <StatusBadge job={job} />
                    <span className="duration-tag">
                      {(job.result?.duration ?? job.config.duration).toFixed(1)}
                      s
                    </span>
                    <span className="open-take">
                      <ArrowRight size={20} />
                    </span>
                  </div>
                  <h3>{job.name}</h3>
                  <div className="take-workflow">
                    {workflows[job.config.workflow].label}
                    {job.config.workflow === "restyle" &&
                    job.config.stylePreset !== "custom"
                      ? ` · ${stylePresets[job.config.stylePreset].label}`
                      : ""}
                  </div>
                  <p>
                    {new Date(job.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                    <span>
                      {job.config.resolution} ·{" "}
                      {videoModels[job.config.model].label}
                    </span>
                  </p>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="empty-library">
          <Layers3 size={30} strokeWidth={1.2} />
          <h3>
            {jobs.length ? "No takes match that." : "A home for every take."}
          </h3>
          <p>
            {jobs.length
              ? "Try another search or filter."
              : "Your videos will be here, ready to revisit and reimagine."}
          </p>
          <Button
            variant="outline"
            disabled={!jobs.length && newDisabled}
            onClick={() =>
              jobs.length ? (setFilter("all"), setSearch("")) : onNew()
            }
          >
            {jobs.length ? "Clear filters" : "Create your first take"}
            <ArrowRight size={14} />
          </Button>
        </div>
      )}
    </section>
  );
}

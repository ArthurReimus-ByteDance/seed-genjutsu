"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Film,
  History,
  Layers3,
  Loader2,
  LogOut,
  MoreHorizontal,
  Plus,
  ScanFace,
  Settings2,
  ShieldCheck,
  Sparkles,
  Volume2,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AuthDialog } from "./auth-dialog";
import { UploadTile } from "./upload-tile";
import { api, queryKeys } from "@/lib/api";
import {
  createJobSchema,
  terminal,
  type Upload,
  type Job,
} from "@/lib/schemas";
import { cn } from "@/lib/utils";

const promptSchema = createJobSchema.pick({ prompt: true });
const defaultPrompt =
  "Replace the person with my character. Keep the original performance, camera movement, and environment.";
const stageLabels: Record<string, string> = {
  queued: "In the queue",
  masking: "Tracking the performance",
  image_preparation: "Preparing the scene image",
  review: "Ready for your review",
  registering: "Registering your reference",
  asset_review: "Processing the reference",
  submitting: "Sending to Seedance",
  generating: "Creating your video",
  complete: "Ready to make an impression",
  cancelled: "Cancelled",
};
function Hint({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
function StatusPill({ job }: { job: Job }) {
  return (
    <span
      className={cn(
        "status-pill",
        job.status === "succeeded"
          ? "success"
          : job.status === "failed" || job.status === "needs_attention"
            ? "failure"
            : "",
      )}
    >
      {["processing", "generating", "queued"].includes(job.status) ? (
        <Loader2 size={11} className="animate-spin" />
      ) : (
        <span className="status-dot" />
      )}
      {job.status === "awaiting_approval"
        ? "Review ready"
        : job.status === "needs_attention"
          ? "Needs attention"
          : job.status.charAt(0).toUpperCase() + job.status.slice(1)}
    </span>
  );
}

export function Studio() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("job");
  const client = useQueryClient();
  const [authOpen, setAuthOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [view, setView] = useState<"studio" | "library">("studio");
  const [tab, setTab] = useState<string | null>(null);
  const [source, setSource] = useState<Upload | null>(null);
  const [character, setCharacter] = useState<Upload | null>(null);
  const [start, setStart] = useState(0);
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState<"480p" | "720p" | "1080p">(
    "720p",
  );
  const [prepareImage, setPrepareImage] = useState(false);
  const [preserveAudio, setPreserveAudio] = useState(true);
  const [target, setTarget] = useState("person");
  const form = useForm<{ prompt: string }>({
    resolver: zodResolver(promptSchema),
    defaultValues: { prompt: defaultPrompt },
  });
  const watchedPrompt = useWatch({ control: form.control, name: "prompt" });
  const session = useQuery({
    queryKey: queryKeys.session,
    queryFn: api.session,
  });
  const user = session.data?.user;
  const [signingOut, setSigningOut] = useState(false);
  const capabilities = useQuery({
    queryKey: queryKeys.capabilities,
    queryFn: api.capabilities,
    enabled: !!user && !signingOut,
    refetchInterval: 15000,
  });
  const history = useQuery({
    queryKey: queryKeys.jobs,
    queryFn: api.jobs,
    enabled: !!user && !signingOut,
    refetchInterval: (q) =>
      q.state.data?.some((j) => !terminal(j.status)) ? 4000 : false,
  });
  const generation = useQuery({
    queryKey: queryKeys.job(selectedId ?? ""),
    queryFn: ({ signal }) => api.job(selectedId!, signal),
    enabled: !!user && !!selectedId && !signingOut,
    refetchInterval: (q) =>
      q.state.data && !terminal(q.state.data.status) ? 2500 : false,
  });
  const active = selectedId ? generation.data : null;
  const currentSource = active?.source ?? source;
  const currentCharacter = active?.character ?? character;
  const busy = !!active && !terminal(active.status);
  useEffect(() => {
    const open = () => {
      if (user && !signingOut) setAuthOpen(true);
    };
    window.addEventListener("recast:auth-required", open);
    return () => window.removeEventListener("recast:auth-required", open);
  }, [user, signingOut]);
  function select(job: Job) {
    setTab(null);
    setView("studio");
    client.setQueryData(queryKeys.job(job.id), job);
    router.replace("/?job=" + job.id, { scroll: false });
  }
  async function refresh(job: Job) {
    select(job);
    await client.invalidateQueries({ queryKey: queryKeys.jobs });
  }
  const create = useMutation({
    mutationFn: api.create,
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  });
  const approve = useMutation({
    mutationFn: api.approve,
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: api.cancel,
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  });
  function fresh() {
    router.replace("/", { scroll: false });
    setTab(null);
    setView("studio");
  }
  function reuse() {
    if (!active) return;
    setSource(active.source);
    setCharacter(active.character);
    form.reset({ prompt: active.prompt });
    setStart(active.config.start);
    setDuration(active.config.duration);
    setResolution(active.config.resolution);
    setPrepareImage(active.config.prepareImage);
    setPreserveAudio(active.config.preserveAudio);
    setTarget(active.config.target);
    fresh();
  }
  async function logout() {
    setSigningOut(true);
    try {
      await client.cancelQueries();
      await api.logout();
      client.clear();
      client.setQueryData(queryKeys.session, {
        user: null,
        registration: session.data?.registration ?? false,
      });
      setSource(null);
      setCharacter(null);
      setAuthOpen(false);
      fresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not sign out.",
      );
    } finally {
      setSigningOut(false);
    }
  }
  function generate() {
    if (create.isPending || approve.isPending || busy) return;
    if (!user) {
      setAuthOpen(true);
      return;
    }
    if (active?.status === "awaiting_approval") {
      approve.mutate(active.id);
      return;
    }
    if (active) {
      reuse();
      return;
    }
    void form.handleSubmit((values) => {
      if (!source || !character) {
        toast.error("Add your source video and character image first.");
        return;
      }
      const parsed = createJobSchema.safeParse({
        sourceId: source.id,
        characterId: character.id,
        ...values,
        start,
        duration,
        resolution,
        prepareImage,
        preserveAudio,
        target,
      });
      if (!parsed.success) {
        toast.error(parsed.error.issues[0].message);
        return;
      }
      create.mutate(parsed.data);
    })();
  }
  const options = active?.config;
  const selectedTab =
    tab ??
    (active?.result
      ? "result"
      : active?.status === "awaiting_approval"
        ? active.anchor
          ? "anchor"
          : "masked"
        : "source");
  const shown =
    selectedTab === "result"
      ? active?.result
      : selectedTab === "anchor"
        ? active?.anchor
        : selectedTab === "masked"
          ? active?.masked
          : currentSource;
  const canRun =
    !!currentSource &&
    !!currentCharacter &&
    !busy &&
    !create.isPending &&
    !approve.isPending;
  const maxDuration = currentSource?.duration
    ? Math.min(30, currentSource.duration - (options?.start ?? start))
    : 30;
  const stage = active ? (stageLabels[active.stage] ?? active.stage) : "";
  return (
    <div className="app-shell">
      <aside className="rail">
        <button
          className="brand-symbol"
          aria-label="Recast home"
          onClick={fresh}
        >
          <span />
          <span />
        </button>
        <div className="rail-group">
          <Hint label="Character studio">
            <button
              aria-label="Character studio"
              className={cn("rail-button", view === "studio" && "active")}
              onClick={() => setView("studio")}
            >
              <ScanFace size={21} />
            </button>
          </Hint>
          <Hint label="Your generations">
            <button
              aria-label="Your generations"
              className={cn("rail-button", view === "library" && "active")}
              onClick={() => (user ? setView("library") : setAuthOpen(true))}
            >
              <Layers3 size={20} />
            </button>
          </Hint>
        </div>
        <div className="rail-bottom">
          <Hint label="How it works">
            <button
              className="rail-button"
              aria-label="How it works"
              onClick={() => setHelpOpen(true)}
            >
              <CircleHelp size={19} />
            </button>
          </Hint>
          <Hint label="Connections">
            <button
              className="rail-button"
              aria-label="Connections"
              onClick={() => (user ? setSettingsOpen(true) : setAuthOpen(true))}
            >
              <Settings2 size={19} />
            </button>
          </Hint>
          {user ? (
            <Hint label="Sign out">
              <button
                className="avatar"
                aria-label="Sign out"
                onClick={() => void logout()}
              >
                {user.name.charAt(0).toUpperCase()}
              </button>
            </Hint>
          ) : (
            <Hint label="Sign in">
              <button
                className="avatar"
                aria-label="Sign in"
                onClick={() => setAuthOpen(true)}
              >
                <ArrowRight size={16} />
              </button>
            </Hint>
          )}
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button onClick={fresh} className="wordmark">
              recast<span className="wordmark-dot">.</span>
            </button>
            <span className="crumb-slash">/</span>
            <span className="workspace-label">Personal workspace</span>
            <ChevronRight size={13} />
            <span className="current-crumb">
              {view === "library" ? "Library" : "Character swap"}
            </span>
          </div>
          <div className="top-actions">
            <button
              className="mobile-tool"
              aria-label="Your generations"
              onClick={() => (user ? setView("library") : setAuthOpen(true))}
            >
              <History size={18} />
            </button>
            <button
              className="mobile-tool"
              aria-label="Connections"
              onClick={() => (user ? setSettingsOpen(true) : setAuthOpen(true))}
            >
              <Settings2 size={18} />
            </button>
            <span className="private-pill">
              <ShieldCheck size={12} />
              Private studio
            </span>
            {user ? (
              <button
                className="top-user"
                onClick={() => setSettingsOpen(true)}
              >
                {user.name}
              </button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAuthOpen(true)}
              >
                Sign in
                <ArrowUpRight size={13} />
              </Button>
            )}
          </div>
        </header>
        <div className="editor-layout">
          <section
            className="control-panel"
            aria-label="Generation controls"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                generate();
              }
            }}
          >
            <div className="panel-heading">
              <div className="eyebrow">
                <ScanFace size={13} />
                CHARACTER STUDIO<span className="tiny-label">BETA</span>
              </div>
              <h1>
                A new character.
                <br />
                <span>Every move.</span>
              </h1>
              <p>
                Change who’s in the scene.
                <br />
                Keep what makes it yours.
              </p>
            </div>
            <div className="section-title">
              Your references<span>2 inputs</span>
            </div>
            <div className="upload-grid">
              <UploadTile
                kind="video"
                value={currentSource}
                onChange={(v) => {
                  setSource(v);
                  setStart(0);
                  setDuration(v?.duration ? Math.min(30, v.duration) : 5);
                }}
                authenticated={!!user}
                onAuth={() => setAuthOpen(true)}
                disabled={!!active}
              />
              <UploadTile
                kind="character"
                value={currentCharacter}
                onChange={setCharacter}
                authenticated={!!user}
                onAuth={() => setAuthOpen(true)}
                disabled={!!active}
              />
            </div>
            {currentSource && (
              <div className="trim-section">
                <div className="trim-label">
                  <span>
                    <Film size={12} />
                    Selected performance
                  </span>
                  <span>{(options?.duration ?? duration).toFixed(1)}s</span>
                </div>
                <div className="trim-inputs">
                  <label>
                    Start
                    <Input
                      aria-label="Clip start in seconds"
                      type="number"
                      min={0}
                      max={Math.max(0, (currentSource.duration ?? 4) - 4)}
                      step={0.1}
                      value={options?.start ?? start}
                      disabled={!!active}
                      onChange={(e) => {
                        const v = Math.max(0, Number(e.target.value));
                        setStart(v);
                        setDuration(
                          Math.max(
                            4,
                            Math.min(
                              duration,
                              (currentSource.duration ?? 4) - v,
                            ),
                          ),
                        );
                      }}
                    />
                    <span>s</span>
                  </label>
                  <label>
                    Length
                    <Input
                      aria-label="Clip duration in seconds"
                      type="number"
                      min={4}
                      max={Math.max(4, maxDuration)}
                      step={0.1}
                      value={options?.duration ?? duration}
                      disabled={!!active}
                      onChange={(e) => setDuration(Number(e.target.value))}
                    />
                    <span>s</span>
                  </label>
                </div>
                <Slider
                  aria-label="Clip length"
                  min={4}
                  max={Math.max(4, maxDuration)}
                  step={0.5}
                  value={[options?.duration ?? duration]}
                  disabled={!!active}
                  onValueChange={(v) => setDuration(v[0])}
                />
              </div>
            )}
            <div className="prompt-header">
              <label htmlFor="prompt">The direction</label>
              <span>
                <WandSparkles size={12} />
                Make it your own
              </span>
            </div>
            <div className="prompt-box">
              <Textarea
                id="prompt"
                aria-label="Generation prompt"
                {...form.register("prompt")}
                value={active?.prompt ?? watchedPrompt}
                disabled={!!active}
                maxLength={3000}
                placeholder="Describe your character swap. What changes? What stays?"
              />
              <div className="prompt-bottom">
                <span>{(active?.prompt ?? watchedPrompt).length}/3000</span>
                <button
                  type="button"
                  disabled={!!active}
                  aria-label="Reset prompt"
                  onClick={() => form.setValue("prompt", defaultPrompt)}
                >
                  <WandSparkles size={13} />
                </button>
              </div>
            </div>
            {form.formState.errors.prompt && (
              <p className="field-error">
                {form.formState.errors.prompt.message}
              </p>
            )}
            <div className="target-row">
              <label htmlFor="target">Who to replace</label>
              <Input
                id="target"
                value={options?.target ?? target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={!!active}
                placeholder="person in the blue jacket"
                maxLength={160}
              />
            </div>
            <div className="options-divider" />
            <div className="settings-row">
              <div>
                <span className="option-title">
                  <Sparkles size={14} />
                  Prepare the first-frame look
                </span>
                <p>
                  {capabilities.data?.image
                    ? "Preview your character in the scene."
                    : "Optional · connect Seedream to enable."}
                </p>
              </div>
              <Switch
                aria-label="Prepare the first-frame look"
                checked={options?.prepareImage ?? prepareImage}
                disabled={!!active || !capabilities.data?.image}
                onCheckedChange={setPrepareImage}
              />
            </div>
            <div className="settings-row">
              <div>
                <span className="option-title">
                  <Volume2 size={14} />
                  Keep original audio
                </span>
                <p>Bring the source soundtrack along.</p>
              </div>
              <Switch
                aria-label="Keep original audio"
                checked={options?.preserveAudio ?? preserveAudio}
                disabled={!!active}
                onCheckedChange={setPreserveAudio}
              />
            </div>
            <div className="output-row">
              <div className="model-pill">
                <span className="model-spark">
                  <Sparkles size={13} />
                </span>
                <span>Seedance 2.5</span>
              </div>
              <select
                aria-label="Output resolution"
                value={options?.resolution ?? resolution}
                onChange={(e) =>
                  setResolution(e.target.value as typeof resolution)
                }
                disabled={!!active}
              >
                <option value="480p">480p · Draft</option>
                <option value="720p">720p · HD</option>
                <option value="1080p">1080p · Full HD</option>
              </select>
            </div>
            <div className="generate-area">
              <Button
                className="generate-button"
                onClick={generate}
                disabled={
                  (!!user && !canRun) || create.isPending || approve.isPending
                }
              >
                {create.isPending || approve.isPending ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Sparkles size={16} />
                )}
                <span>
                  {busy
                    ? "Creating your swap…"
                    : active?.status === "awaiting_approval"
                      ? "Approve & generate"
                      : active
                        ? "Use these inputs"
                        : "Prepare character swap"}
                </span>
                <span className="key-hint">⌘ ↵</span>
              </Button>
              <div className="generate-note">
                <ShieldCheck size={11} />
                {active?.status === "awaiting_approval"
                  ? "You approve the references before video generation."
                  : "Your media stays in your private workspace."}
              </div>
            </div>
            {active && (
              <button className="new-swap-button" onClick={fresh}>
                <Plus size={14} />
                Start a new swap
              </button>
            )}
          </section>
          <main className="workspace" id="workspace">
            <div className="workspace-heading">
              <div>
                <span className="section-kicker">
                  {view === "library" ? "YOUR CREATIVE ARCHIVE" : "THE CANVAS"}
                </span>
                <h2>
                  {view === "library"
                    ? "Every take, in one place."
                    : active
                      ? "Your character swap"
                      : "From a performance to a possibility."}
                </h2>
              </div>
              <div className="canvas-actions">
                {view === "studio" && (
                  <button
                    className="icon-button"
                    aria-label="Open generation library"
                    onClick={() =>
                      user ? setView("library") : setAuthOpen(true)
                    }
                  >
                    <History size={17} />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label="Start a new swap"
                  onClick={fresh}
                >
                  <Plus size={18} />
                </button>
              </div>
            </div>
            {generation.isError && (
              <div role="alert" className="connection-error">
                {generation.error.message}
              </div>
            )}
            {session.isError && (
              <div role="alert" className="connection-error">
                The studio could not connect. Check that the database is
                running, then refresh.
              </div>
            )}
            {view === "library" ? (
              <section className="library-view">
                <div className="library-toolbar">
                  <span>
                    {history.data?.length ?? 0}{" "}
                    {history.data?.length === 1 ? "generation" : "generations"}
                  </span>
                  <Button variant="outline" size="sm" onClick={fresh}>
                    <Plus size={13} />
                    New swap
                  </Button>
                </div>
                {history.isLoading ? (
                  <div className="canvas-empty">
                    <Loader2 className="animate-spin" />
                  </div>
                ) : history.data?.length ? (
                  <div className="library-grid">
                    {history.data.map((job) => (
                      <button
                        className="generation-card"
                        key={job.id}
                        onClick={() => select(job)}
                      >
                        <div className="generation-poster">
                          <Image
                            src={
                              job.anchor?.url ??
                              job.source.posterUrl ??
                              job.character.url
                            }
                            alt={job.name}
                            fill
                            unoptimized
                          />
                          <span className="card-duration">
                            {job.config.duration.toFixed(1)}s
                          </span>
                          <StatusPill job={job} />
                        </div>
                        <h3>{job.name}</h3>
                        <p>
                          {new Date(job.createdAt).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                          <span>{job.config.resolution} · Seedance 2.5</span>
                        </p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="library-empty">
                    <Layers3 size={32} strokeWidth={1} />
                    <h3>A home for every take.</h3>
                    <p>Your generations will live here, ready to revisit.</p>
                    <Button variant="outline" onClick={fresh}>
                      Create your first swap
                      <ArrowRight size={14} />
                    </Button>
                  </div>
                )}
              </section>
            ) : (
              <>
                <section
                  className={cn("canvas", !currentSource && "canvas-idle")}
                >
                  {currentSource ? (
                    <>
                      <div className="canvas-toolbar">
                        <div className="preview-tabs">
                          {[
                            {
                              key: "source",
                              label: "Original",
                              media: currentSource,
                            },
                            {
                              key: "masked",
                              label: "Masked",
                              media: active?.masked,
                            },
                            {
                              key: "anchor",
                              label: "Scene image",
                              media: active?.anchor,
                            },
                            {
                              key: "result",
                              label: "Result",
                              media: active?.result,
                            },
                          ]
                            .filter((t) => t.media)
                            .map((t) => (
                              <button
                                key={t.key}
                                onClick={() => setTab(t.key)}
                                className={
                                  selectedTab === t.key ? "selected" : ""
                                }
                              >
                                {t.label}
                              </button>
                            ))}
                        </div>
                        {active && <StatusPill job={active} />}
                      </div>
                      <div className="media-stage">
                        {shown ? (
                          shown.mime.startsWith("video") ? (
                            <video
                              key={shown.id}
                              src={shown.url}
                              poster={shown.posterUrl ?? undefined}
                              controls
                              playsInline
                              preload="metadata"
                              aria-label={
                                selectedTab === "result"
                                  ? "Generated character swap"
                                  : "Performance preview"
                              }
                            />
                          ) : (
                            <Image
                              src={shown.url}
                              alt="Prepared character in the source scene"
                              width={shown.width}
                              height={shown.height}
                              unoptimized
                            />
                          )
                        ) : (
                          <Loader2 className="animate-spin" />
                        )}
                        {busy && (
                          <div className="processing-overlay">
                            <div className="processing-orb">
                              <ScanFace size={28} strokeWidth={1} />
                            </div>
                            <span>{stage}</span>
                            <p>Your workspace stays ready while we work.</p>
                          </div>
                        )}
                      </div>
                      <div className="canvas-caption">
                        <span>
                          <Film size={12} />
                          {currentSource.width} × {currentSource.height}
                          <i />
                          24 fps output
                        </span>
                        <span>
                          {(options?.duration ?? duration).toFixed(1)} seconds
                          <MoreHorizontal size={16} />
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="empty-composition">
                      <div className="canvas-grid" />
                      <div className="floating-frame frame-back">
                        <Image
                          src="/examples/portrait.jpg"
                          alt="A character reference idea"
                          width={600}
                          height={800}
                        />
                      </div>
                      <div className="floating-frame frame-front">
                        <div className="frame-focus" />
                        <ScanFace size={54} strokeWidth={0.8} />
                        <span>YOUR NEXT CHARACTER</span>
                      </div>
                      <div className="composition-copy">
                        <span className="canvas-label">
                          <span />A DIFFERENT YOU. THE SAME MOMENT.
                        </span>
                        <h3>
                          The performance stays.
                          <br />
                          <span>The possibilities don’t.</span>
                        </h3>
                        <p>
                          Drop a clip and a character image.
                          <br />
                          Let the transformation begin.
                        </p>
                      </div>
                      <div className="canvas-corner corner-tl" />
                      <div className="canvas-corner corner-tr" />
                      <div className="canvas-corner corner-bl" />
                      <div className="canvas-corner corner-br" />
                    </div>
                  )}
                </section>
                {active ? (
                  <section className="run-details">
                    <div className="run-heading">
                      <div>
                        <span className="section-kicker">
                          GENERATION DETAILS
                        </span>
                        <h3>
                          {active.status === "failed" ||
                          active.status === "needs_attention"
                            ? "This take needs a little attention."
                            : stage}
                        </h3>
                      </div>
                      {active.result ? (
                        <Button variant="outline" asChild>
                          <a
                            href={active.result.url + "?download=1"}
                            download={active.result.name}
                          >
                            <ArrowDownToLine size={14} />
                            Download
                          </a>
                        </Button>
                      ) : !terminal(active.status) ||
                        active.status === "awaiting_approval" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => cancel.mutate(active.id)}
                          disabled={cancel.isPending}
                        >
                          Cancel run
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={reuse}>
                          Use inputs
                          <ArrowRight size={13} />
                        </Button>
                      )}
                    </div>
                    <div className="run-progress">
                      <span style={{ width: active.progress + "%" }} />
                    </div>
                    {active.error && (
                      <p role="alert" className="run-error">
                        {active.error}
                      </p>
                    )}
                    {active.status === "awaiting_approval" && (
                      <p className="review-note">
                        <Check size={14} />
                        Check the masked performance
                        {active.anchor ? " and scene image" : ""}, then choose{" "}
                        <strong>Approve & generate</strong>.
                      </p>
                    )}
                    <div className="event-list">
                      {active.events.slice(-4).map((e) => (
                        <div key={e.id}>
                          <span className="event-dot" />
                          <p>{e.message}</p>
                          <time>
                            {new Date(e.createdAt).toLocaleTimeString(
                              undefined,
                              { hour: "2-digit", minute: "2-digit" },
                            )}
                          </time>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : (
                  <section className="below-canvas">
                    <div className="workflow-strip">
                      <div>
                        <span className="step-number">01</span>
                        <span>
                          Add your references
                          <small>A performance + a new identity</small>
                        </span>
                      </div>
                      <ChevronRight size={15} />
                      <div>
                        <span className="step-number">02</span>
                        <span>
                          Direct the change
                          <small>Your scene, your creative control</small>
                        </span>
                      </div>
                      <ChevronRight size={15} />
                      <div>
                        <span className="step-number">03</span>
                        <span>
                          Make it move<small>Up to 30 seconds, all yours</small>
                        </span>
                      </div>
                    </div>
                    <div className="creative-note">
                      <div>
                        <Sparkles size={15} />
                        <p>
                          Same camera. Same rhythm.
                          <br />
                          <span>A whole new character.</span>
                        </p>
                      </div>
                      <button onClick={() => setHelpOpen(true)}>
                        See how it works
                        <ArrowUpRight size={13} />
                      </button>
                    </div>
                  </section>
                )}
              </>
            )}
            <footer className="workspace-footer">
              <span>
                <span
                  className={cn(
                    "connection-dot",
                    capabilities.data?.video && "connected",
                  )}
                />
                {user
                  ? capabilities.data?.missing.length
                    ? "Some connections need setup"
                    : "Your models are connected"
                  : "YOUR PRIVATE CREATIVE SPACE"}
              </span>
              <span>
                BUILT FOR THE NEXT TAKE<span className="footer-mark">R</span>
              </span>
            </footer>
          </main>
        </div>
      </div>
      <AuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
        registration={session.data?.registration ?? false}
      />
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="connection-dialog">
          <DialogTitle>Studio connections</DialogTitle>
          <DialogDescription>
            Your model keys stay on the server. These connections power your
            private creative workspace.
          </DialogDescription>
          <div className="connection-list">
            {[
              {
                name: "Seedance 2.5",
                description: "Video generation · BytePlus ModelArk",
                ready: capabilities.data?.video,
              },
              {
                name: "SAM 3.1 on fal.ai",
                description: "Subject tracking and masked performance",
                ready: capabilities.data?.sam,
              },
              {
                name: "Virtual Portrait",
                description: "Trusted video reference assets",
                ready: capabilities.data?.portraits,
              },
              {
                name: "Media storage",
                description:
                  "BytePlus TOS · private source files and finished videos",
                ready: capabilities.data?.storage,
              },
              {
                name: "Seedream scene preparation",
                description:
                  "Optional first-frame image · verified model ID required",
                ready: capabilities.data?.image,
              },
              {
                name: "Processing worker",
                description: "Durable processing in the background",
                ready: !!capabilities.data?.workerSeenAt,
              },
            ].map((item) => (
              <div key={item.name}>
                <span
                  className={cn("connection-icon", item.ready && "configured")}
                >
                  {item.ready ? <Check size={15} /> : <Settings2 size={15} />}
                </span>
                <div>
                  <strong>{item.name}</strong>
                  <p>{item.description}</p>
                </div>
                <span className={item.ready ? "ready-label" : "pending-label"}>
                  {item.ready ? "Configured" : "Needs setup"}
                </span>
              </div>
            ))}
          </div>
          <p className="connection-footnote">
            Connection settings are managed by your workspace operator. A
            configured model still needs account access and eligible references.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setSettingsOpen(false);
              void logout();
            }}
          >
            <LogOut size={13} />
            Sign out
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogTitle>A new character. Your performance.</DialogTitle>
          <DialogDescription>
            Recast turns a source performance into a character-led video.
          </DialogDescription>
          <ol className="help-steps">
            <li>
              <span>01</span>
              <div>
                <strong>Bring a performance</strong>
                <p>
                  Upload a source clip and select 4–30 seconds. Add an image of
                  the character you want to see.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Prepare and review</strong>
                <p>
                  SAM tracks the subject. Optional Seedream preparation lets you
                  review the character’s look in the first scene.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Approve the next take</strong>
                <p>
                  Your masked performance becomes a Virtual Portrait reference.
                  Seedance creates the edit, then your original sound can be
                  restored.
                </p>
              </div>
            </li>
          </ol>
          <p className="connection-footnote">
            Your references guide the result. Review every take for identity,
            motion, scene changes, and timing.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

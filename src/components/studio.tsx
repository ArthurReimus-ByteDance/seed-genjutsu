"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import {
  ArrowRight,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  History,
  Layers3,
  Loader2,
  Plus,
  RotateCcw,
  ScanFace,
  Settings2,
  Sparkles,
  Volume2,
  WandSparkles,
  X,
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
import { UploadTile } from "./upload-tile";
import { api, demoApi, studioQueryKeys, type DemoScenario } from "@/lib/api";
import { reconcileJob } from "@/lib/studio-cache";
import {
  createJobSchema,
  terminal,
  type CreateJob,
  type Upload,
  type Job,
} from "@/lib/schemas";
import { cn } from "@/lib/utils";
import {
  ExampleCanvas,
  MediaCanvas,
  RunDetails,
  statusNames,
} from "./studio/canvas";
import { BytePlusMark } from "./studio/byteplus-mark";
import { Library } from "./studio/library";
import { PromptEnhancer } from "./studio/prompt-enhancer";
import { WorkflowControls } from "./studio/workflow-controls";
import { ReferenceTray } from "./studio/reference-tray";
import {
  switchDirection,
  moveReference,
  workflowSettings,
  workflowConnected,
  workflowInputIssue,
  reviewMedia,
  type StudioReference,
} from "./studio/workflow-state";
import {
  workflows,
  type WorkflowId,
  type StylePresetId,
} from "@/lib/workflows";
import { StudioLoading } from "./studio/loading";
import { APP_NAME, SEEDREAM_NAME } from "@/lib/branding";
import {
  DEFAULT_VIDEO_MODEL,
  videoModels,
  videoModelIds,
  clampClipDuration,
  normalizeClip,
  type VideoModelId,
} from "@/lib/video-models";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const defaultPrompt =
  "Replace the selected performer with the character from Image 1. Keep the source performance, camera and scene.";
const samplePrompt =
  "Replace the dancer with the pearl android in the lavender jacket from Image 1. Keep the source dance, warm gallery lighting and camera movement.";
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

export function Studio({
  mode = "live",
  demoAvailable = false,
}: {
  mode?: "live" | "demo";
  demoAvailable?: boolean;
}) {
  const demo = mode === "demo",
    apiClient = demo ? demoApi : api,
    keys = studioQueryKeys(mode),
    base = demo ? "/preview" : "/";
  const settingsLabel = demo ? "Sample settings" : "Studio connections";
  const router = useRouter(),
    params = useSearchParams(),
    selectedId = params.get("job"),
    client = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false),
    [helpOpen, setHelpOpen] = useState(false);
  const [view, setView] = useState<"studio" | "library">("studio"),
    [mobilePanel, setMobilePanel] = useState<"inputs" | "preview">(() =>
      selectedId ? "preview" : "inputs",
    ),
    [tab, setTab] = useState<string | null>(null);
  const [source, setSource] = useState<Upload | null>(null),
    [character, setCharacter] = useState<Upload | null>(null);
  const [start, setStart] = useState(0),
    [duration, setDuration] = useState(6),
    [resolution, setResolution] = useState<"480p" | "720p" | "1080p">("720p");
  const [model, setModel] = useState<VideoModelId>(DEFAULT_VIDEO_MODEL);
  const [workflow, setWorkflow] = useState<WorkflowId>("character_swap");
  const [references, setReferences] = useState<StudioReference[]>([]);
  const [operation, setOperation] = useState<CreateJob["operation"]>("modify");
  const [stylePreset, setStylePreset] = useState<StylePresetId>("custom");
  const directions = useRef<Partial<Record<WorkflowId, string>>>({});
  const [enhancingPrompt, setEnhancingPrompt] = useState(false);
  const [draftSession, setDraftSession] = useState(0);
  const sampleContext = useRef(0);
  const lastSelectedId = useRef(selectedId);
  function resetDraftSession() {
    sampleContext.current++;
    setDraftSession((current) => current + 1);
  }
  useEffect(() => {
    if (lastSelectedId.current !== selectedId) {
      sampleContext.current++;
      lastSelectedId.current = selectedId;
    }
  }, [selectedId]);
  const [uploading, setUploading] = useState({
    video: false,
    character: false,
    references: false,
  });
  const mediaBusy =
    uploading.video || uploading.character || uploading.references;
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [startDraft, setStartDraft] = useState<string | null>(null);
  const [durationDraft, setDurationDraft] = useState<string | null>(null);
  const [prepareImage, setPrepareImage] = useState(false),
    [preserveAudio, setPreserveAudio] = useState(true),
    [target, setTarget] = useState("person");
  const [advanced, setAdvanced] = useState(false),
    [scenario, setScenario] = useState<DemoScenario>("success");
  const form = useForm<{ prompt: string }>({
    defaultValues: { prompt: defaultPrompt },
  });
  const prompt = useWatch({ control: form.control, name: "prompt" });
  const capabilities = useQuery({
    queryKey: keys.capabilities,
    queryFn: apiClient.capabilities,
    refetchInterval: 15000,
  });
  const history = useQuery({
    queryKey: keys.jobs,
    queryFn: apiClient.jobs,
    refetchInterval: (q) =>
      q.state.data?.some((job) => !terminal(job.status))
        ? demo
          ? 1000
          : 4000
        : false,
  });
  const generation = useQuery({
    queryKey: keys.job(selectedId ?? ""),
    queryFn: ({ signal }) => apiClient.job(selectedId!, signal),
    enabled: !!selectedId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: (q) =>
      q.state.data && !terminal(q.state.data.status)
        ? demo
          ? 700
          : 2500
        : false,
  });
  const active = selectedId ? generation.data : null,
    options = active?.config,
    currentSource = active ? active.source : source,
    currentCharacter = active ? active.character : character;
  const draftSettings = workflowSettings({
    workflow,
    model,
    prepareImage,
    character,
    references,
  });
  const currentWorkflow = options?.workflow ?? workflow;
  const swap = currentWorkflow === "character_swap";
  const currentReferences = active ? active.references : references;
  const currentModel = options?.model ?? draftSettings.model;
  const currentPrepareImage =
    options?.prepareImage ?? draftSettings.prepareImage;
  const currentOperation = options?.operation ?? operation;
  const currentStylePreset = options?.stylePreset ?? stylePreset;
  const currentPreserveAudio = options?.preserveAudio ?? preserveAudio;
  const modelProfile = videoModels[currentModel];
  const busy = !!active && !terminal(active.status);
  function select(job: Job) {
    resetDraftSession();
    setTab(null);
    setView("studio");
    setMobilePanel("preview");
    void client.invalidateQueries({ queryKey: keys.job(job.id), exact: true });
    router.replace(base + "?job=" + job.id, { scroll: false });
  }
  async function refresh(job: Job) {
    await reconcileJob(client, keys, job);
  }
  const create = useMutation({
    mutationFn: (input: ReturnType<typeof createJobSchema.parse>) =>
      apiClient.create(input, demo ? scenario : undefined),
    onMutate: () => sampleContext.current,
    onSuccess: async (job, _input, session) => {
      await refresh(job);
      if (session === sampleContext.current) select(job);
    },
    onError: (error) => toast.error(error.message),
  });
  const approve = useMutation({
    mutationFn: apiClient.approve,
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });
  const cancel = useMutation({
    mutationFn: apiClient.cancel,
    onSuccess: async (job) => {
      setCancellingId(job.id);
      await refresh(job);
    },
    onError: (error) => toast.error(error.message),
  });
  const sample = useMutation({
    mutationFn: async (session: number) => ({
      refs: await demoApi.samples(),
      session,
    }),
    onSuccess: ({ refs, session }) => {
      if (session !== sampleContext.current) return;
      resetDraftSession();
      setStartDraft(null);
      setDurationDraft(null);
      router.replace(base, { scroll: false });
      setSource(refs.source);
      setCharacter(refs.character);
      setWorkflow("character_swap");
      setReferences([]);
      setOperation("modify");
      setStylePreset("custom");
      directions.current = {};
      setDuration(6);
      setStart(0);
      setTarget("person in a black jacket");
      setPrepareImage(true);
      setAdvanced(true);
      form.reset({ prompt: samplePrompt });
      setView("studio");
      setMobilePanel("inputs");
      setTab(null);
      toast.success("Example loaded. Make it your own.");
    },
    onError: (error, session) => {
      if (session === sampleContext.current) toast.error(error.message);
    },
  });
  const autoSample = useRef(false);
  const loadSample = sample.mutate;
  useEffect(() => {
    if (demo && params.get("sample") === "gallery" && !autoSample.current) {
      autoSample.current = true;
      loadSample(sampleContext.current);
    }
  }, [demo, params, loadSample]);
  function fresh() {
    if (
      create.isPending ||
      approve.isPending ||
      cancel.isPending ||
      mediaBusy ||
      enhancingPrompt
    )
      return;
    resetDraftSession();
    setStartDraft(null);
    setDurationDraft(null);
    router.replace(base, { scroll: false });
    setSource(null);
    setCharacter(null);
    setStart(0);
    setDuration(6);
    setModel(DEFAULT_VIDEO_MODEL);
    setWorkflow("character_swap");
    setReferences([]);
    setOperation("modify");
    setStylePreset("custom");
    directions.current = {};
    setTarget("person");
    setPrepareImage(false);
    setPreserveAudio(true);
    setTab(null);
    setView("studio");
    setMobilePanel("inputs");
    form.reset({ prompt: defaultPrompt });
    create.reset();
    approve.reset();
    cancel.reset();
  }
  function reuse() {
    if (
      !active ||
      create.isPending ||
      approve.isPending ||
      cancel.isPending ||
      mediaBusy ||
      enhancingPrompt
    )
      return;
    resetDraftSession();
    setStartDraft(null);
    setDurationDraft(null);
    setSource(active.source);
    setCharacter(active.character);
    setWorkflow(active.config.workflow);
    setReferences(active.references);
    setOperation(active.config.operation);
    setStylePreset(active.config.stylePreset);
    directions.current = { [active.config.workflow]: active.prompt };
    setStart(active.config.start);
    setDuration(active.config.duration);
    setModel(active.config.model);
    setResolution(active.config.resolution);
    setPrepareImage(active.config.prepareImage);
    setPreserveAudio(active.config.preserveAudio);
    setTarget(active.config.target);
    form.reset({ prompt: active.prompt });
    setTab(null);
    setView("studio");
    setMobilePanel("inputs");
    router.replace(base, { scroll: false });
  }
  const connected =
    demo ||
    workflowConnected(capabilities.data, currentWorkflow, currentPrepareImage);
  function applyClip(
    nextStart = Number(startDraft ?? start),
    nextDuration = Number(durationDraft ?? duration),
    nextModel = currentModel,
  ) {
    const clip = normalizeClip({
      start: nextStart,
      duration: nextDuration,
      sourceDuration: source?.duration ?? null,
      model: nextModel,
    });
    setStart(clip.start);
    setDuration(clip.duration);
    setStartDraft(null);
    setDurationDraft(null);
    return clip;
  }
  function changeWorkflow(nextWorkflow: WorkflowId) {
    const next = switchDirection(
      {
        workflow,
        prompt: form.getValues("prompt"),
        directions: directions.current,
      },
      nextWorkflow,
    );
    directions.current = next.directions;
    resetDraftSession();
    setWorkflow(nextWorkflow);
    setTab(null);
    form.reset({ prompt: next.prompt });
    applyClip(
      Number(startDraft ?? start),
      Number(durationDraft ?? duration),
      nextWorkflow === "character_swap" ? model : "seedance-2.5",
    );
  }
  function generate() {
    if (view === "library") {
      fresh();
      return;
    }
    if (
      create.isPending ||
      approve.isPending ||
      sample.isPending ||
      busy ||
      mediaBusy ||
      stopping ||
      enhancingPrompt ||
      (!!selectedId && !active)
    )
      return;
    if (!connected) {
      setSettingsOpen(true);
      return;
    }
    if (active?.status === "awaiting_approval") {
      if (!reviewMedia(active)) return;
      approve.mutate(active.id);
      return;
    }
    if (active) {
      reuse();
      return;
    }
    void form.handleSubmit((values) => {
      if (!source) return;
      const input = createJobSchema.safeParse({
        sourceId: source.id,
        ...draftSettings,
        ...values,
        ...applyClip(),
        resolution,
        preserveAudio,
        target:
          workflow === "restyle" || workflow === "motion_transfer"
            ? target.trim() || "person"
            : target,
        operation,
        stylePreset,
      });
      if (!input.success) {
        const promptIssue = input.error.issues.find(
          (issue) => issue.path[0] === "prompt",
        );
        if (promptIssue)
          form.setError("prompt", { message: promptIssue.message });
        toast.error(input.error.issues[0].message);
        return;
      }
      create.mutate(input.data);
    })();
  }
  const stopping =
    cancel.isPending ||
    (!!active && cancellingId === active.id && !terminal(active.status));
  const inputCount =
    Number(!!currentSource) +
    (swap ? Number(!!currentCharacter) : currentReferences.length);
  const inputIssue = workflowInputIssue({
    workflow: currentWorkflow,
    source: currentSource,
    character: currentCharacter,
    references: currentReferences,
    prompt: active?.prompt ?? prompt,
    stylePreset: currentStylePreset,
  });
  const inputsReady = !inputIssue;
  const uploadSessionKey = `${mode}:${selectedId ?? `draft-${draftSession}`}:${currentWorkflow}`;
  const waiting = capabilities.isPending;
  const pending = create.isPending || approve.isPending;
  const inputsDisabled = !!selectedId || pending || sample.isPending;
  const primaryLabel =
    view === "library"
      ? "New take"
      : sample.isPending
        ? "Loading example…"
        : enhancingPrompt
          ? "Enhancing your direction…"
          : mediaBusy
            ? "Uploading references…"
            : pending
              ? create.isPending
                ? "Preparing your take…"
                : "Starting generation…"
              : busy
                ? stopping
                  ? "Stopping your take…"
                  : active?.status === "generating"
                    ? "Creating your video…"
                    : ["registering", "asset_review", "submitting"].includes(
                          active?.stage ?? "",
                        )
                      ? "Starting your video…"
                      : "Preparing references…"
                : !connected
                  ? "Finish studio setup"
                  : active?.status === "awaiting_approval"
                    ? "Approve & create video"
                    : active
                      ? active.status === "failed" ||
                        active.status === "cancelled"
                        ? "Edit & try again"
                        : active.status === "needs_attention"
                          ? "Review inputs"
                          : "Use these inputs"
                      : "Prepare references";
  const actionDisabled =
    view === "library"
      ? waiting || pending || cancel.isPending || mediaBusy || enhancingPrompt
      : enhancingPrompt ||
        sample.isPending ||
        waiting ||
        mediaBusy ||
        stopping ||
        pending ||
        busy ||
        (!!selectedId && !active) ||
        (active?.status === "awaiting_approval" && !reviewMedia(active)) ||
        (connected && !active && !inputsReady);
  const guidance = sample.isPending
    ? "Loading the example references…"
    : enhancingPrompt
      ? "Refining your direction. You can keep editing."
      : mediaBusy
        ? "Uploading references. You can set the direction while you wait."
        : view === "library" || active
          ? null
          : !connected
            ? "Connect the remaining services to create."
            : inputIssue;
  const primary =
    active?.result && view === "studio" ? (
      <Button className="primary-action" asChild>
        <a
          href={active.result.url + "?download=1"}
          download={active.result.name}
        >
          <ArrowDownToLine size={16} />
          <span>Download video</span>
          <ArrowRight size={15} className="ml-auto" />
        </a>
      </Button>
    ) : (
      <Button
        className="primary-action"
        onClick={generate}
        disabled={actionDisabled}
      >
        {pending || busy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : view === "library" ? (
          <Plus size={16} />
        ) : active?.status === "awaiting_approval" ? (
          <Check size={16} />
        ) : (
          <Sparkles size={16} />
        )}
        <span>{primaryLabel}</span>
        <span className="shortcut">⌘ ↵</span>
      </Button>
    );
  function trySample() {
    if (mediaBusy || pending || enhancingPrompt || sample.isPending) return;
    if (demo) sample.mutate(sampleContext.current);
    else if (demoAvailable) router.push("/preview?sample=gallery");
  }
  function openLibrary() {
    sampleContext.current++;
    setView("library");
    setMobilePanel("preview");
  }
  const currentStart = options?.start ?? start,
    currentDuration = options?.duration ?? duration,
    maxEnd =
      currentStart +
      clampClipDuration(
        modelProfile.maxDuration,
        currentModel,
        (currentSource?.duration ?? modelProfile.maxDuration) - currentStart,
      );
  const takeTitle =
    active?.status === "succeeded"
      ? demo
        ? "Sample result"
        : "Result"
      : active?.status === "awaiting_approval"
        ? "Review references"
        : active && statusNames[active.status];
  const workspaceTitle =
    view === "library"
      ? "Your takes"
      : (takeTitle ??
        (currentSource ? "Source performance" : "Sample comparison"));
  if (capabilities.isPending) return <StudioLoading />;
  return (
    <div
      className={cn(
        "studio-shell",
        view === "library" && "library-open",
        "mobile-" + mobilePanel,
      )}
    >
      <aside className="studio-rail">
        <button
          className="brand-glyph"
          onClick={() => fresh()}
          aria-label={APP_NAME + " home"}
        >
          <span />
          <span />
        </button>
        <nav aria-label="Workspace">
          <Hint label="Video studio">
            <button
              className={cn("rail-item", view === "studio" && "active")}
              aria-label="Video studio"
              onClick={() => setView("studio")}
            >
              <ScanFace size={21} />
            </button>
          </Hint>
          <Hint label="Your takes">
            <button
              className={cn("rail-item", view === "library" && "active")}
              aria-label="Your takes"
              onClick={openLibrary}
            >
              <Layers3 size={20} />
              {!!history.data?.length && (
                <span className="rail-count">{history.data.length}</span>
              )}
            </button>
          </Hint>
        </nav>
        <div className="rail-lower">
          <Hint label="How it works">
            <button
              className="rail-item"
              aria-label="How it works"
              onClick={() => setHelpOpen(true)}
            >
              <CircleHelp size={19} />
            </button>
          </Hint>
          <Hint label={settingsLabel}>
            <button
              className="rail-item"
              aria-label={settingsLabel}
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={19} />
            </button>
          </Hint>
        </div>
      </aside>
      <div className="studio-main">
        <header className="studio-topbar">
          <div className="studio-breadcrumb">
            <button
              className="wordmark"
              aria-label={APP_NAME}
              onClick={() => fresh()}
            >
              <BytePlusMark />
              <span>{APP_NAME}</span>
            </button>
            <span className="breadcrumb-divider">/</span>
            <span className="current-page">
              {view === "library" ? "Your takes" : "Video studio"}
            </span>
          </div>
          <div className="topbar-actions">
            <button
              className="topbar-icon"
              aria-label="Your takes"
              onClick={openLibrary}
            >
              <History size={17} />
            </button>
            <button
              className="topbar-icon"
              aria-label={settingsLabel}
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={17} />
            </button>
          </div>
        </header>
        <div
          className="mobile-workspace-nav"
          role="group"
          aria-label="Studio view"
        >
          <button
            aria-pressed={view === "studio" && mobilePanel === "inputs"}
            className={cn(
              view === "studio" && mobilePanel === "inputs" && "active",
            )}
            onClick={() => {
              setView("studio");
              setMobilePanel("inputs");
            }}
          >
            Inputs
            <span>
              {inputCount}
              {swap ? "/2" : ""}
            </span>
          </button>
          <button
            aria-pressed={view === "studio" && mobilePanel === "preview"}
            className={cn(
              view === "studio" && mobilePanel === "preview" && "active",
            )}
            onClick={() => {
              setView("studio");
              setMobilePanel("preview");
            }}
          >
            Canvas{active?.status === "awaiting_approval" && <i />}
          </button>
          <button
            aria-pressed={view === "library"}
            className={cn(view === "library" && "active")}
            onClick={openLibrary}
          >
            Your takes
            {history.data?.length ? <span>{history.data.length}</span> : null}
          </button>
        </div>
        <div className="studio-layout">
          <section
            className="controls-panel"
            aria-label="Generation controls"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                generate();
              }
            }}
          >
            <div className="controls-heading">
              <h1>{active ? "Take settings" : "Create a take"}</h1>
              <span className="model-pill">{modelProfile.label}</span>
            </div>
            <div className="controls-scroll">
              <WorkflowControls
                workflow={currentWorkflow}
                operation={currentOperation}
                stylePreset={currentStylePreset}
                disabled={inputsDisabled}
                onWorkflow={changeWorkflow}
                onOperation={setOperation}
                onStylePreset={setStylePreset}
              />
              <div className="field-heading">
                <label>Your references</label>
                <span className={cn(inputsReady && "references-ready")}>
                  {inputsReady ? (
                    <>
                      <Check size={12} />
                      Ready
                    </>
                  ) : (
                    inputCount + (swap ? "/2 added" : " added")
                  )}
                </span>
              </div>
              <div className={cn("reference-grid", !swap && "source-only")}>
                <UploadTile
                  key={"video:" + uploadSessionKey}
                  kind="video"
                  onBusyChange={(busy) =>
                    setUploading((current) => ({ ...current, video: busy }))
                  }
                  value={currentSource}
                  onChange={(value) => {
                    setSource(value);
                    setStartDraft(null);
                    setDurationDraft(null);
                    setStart(0);
                    setDuration(
                      clampClipDuration(
                        Math.floor((value?.duration ?? 6) * 10) / 10,
                        currentModel,
                      ),
                    );
                  }}
                  disabled={inputsDisabled}
                  apiClient={apiClient}
                />
                {swap && (
                  <UploadTile
                    key={"character:" + uploadSessionKey}
                    kind="character"
                    onBusyChange={(busy) =>
                      setUploading((current) => ({
                        ...current,
                        character: busy,
                      }))
                    }
                    value={currentCharacter}
                    onChange={setCharacter}
                    disabled={inputsDisabled}
                    apiClient={apiClient}
                  />
                )}
              </div>
              {!swap && (
                <ReferenceTray
                  key={uploadSessionKey}
                  workflow={currentWorkflow}
                  references={currentReferences}
                  disabled={inputsDisabled}
                  apiClient={apiClient}
                  onBusyChange={(busy) =>
                    setUploading((current) => ({
                      ...current,
                      references: busy,
                    }))
                  }
                  onAdd={(media, role) =>
                    setReferences((current) =>
                      current.length >= 30 ||
                      current.some(
                        (reference) => reference.media.id === media.id,
                      )
                        ? current
                        : [
                            ...current,
                            { id: crypto.randomUUID(), role, media },
                          ],
                    )
                  }
                  onRemove={(id) =>
                    setReferences((current) =>
                      current.filter((reference) => reference.id !== id),
                    )
                  }
                  onRole={(id, role) =>
                    setReferences((current) =>
                      current.map((reference) =>
                        reference.id === id
                          ? { ...reference, role }
                          : reference,
                      ),
                    )
                  }
                  onMove={(id, offset) =>
                    setReferences((current) =>
                      moveReference(current, id, offset),
                    )
                  }
                />
              )}
              {currentSource && (
                <div className="clip-selector">
                  <div className="field-heading">
                    <label>Selected clip</label>
                    <span>
                      {currentDuration.toFixed(1)}s{" "}
                      <span className="muted">
                        of {currentSource.duration?.toFixed(1)}s
                      </span>
                    </span>
                  </div>
                  <div className="clip-time-fields">
                    <label>
                      Start
                      <Input
                        aria-label="Clip start in seconds"
                        type="number"
                        min={0}
                        max={Math.max(0, (currentSource.duration ?? 4) - 4)}
                        step={0.1}
                        value={startDraft ?? currentStart}
                        disabled={inputsDisabled}
                        onFocus={() => setStartDraft(String(start))}
                        onChange={(e) => {
                          const text = e.target.value;
                          setStartDraft(text);
                          const value = Number(text);
                          if (
                            text !== "" &&
                            Number.isFinite(value) &&
                            value >= 0 &&
                            value <= (currentSource.duration ?? 4) - 4
                          ) {
                            setStart(value);
                            setDuration(
                              clampClipDuration(
                                duration,
                                currentModel,
                                (currentSource.duration ?? 4) - value,
                              ),
                            );
                          }
                        }}
                        onBlur={() => {
                          applyClip();
                        }}
                      />
                      <span>s</span>
                    </label>
                    <ChevronRight size={13} />
                    <label>
                      Length
                      <Input
                        aria-label="Clip duration in seconds"
                        type="number"
                        min={4}
                        max={Math.min(
                          modelProfile.maxDuration,
                          (currentSource.duration ?? 4) - currentStart,
                        )}
                        step={modelProfile.durationStep}
                        value={durationDraft ?? currentDuration}
                        disabled={inputsDisabled}
                        onFocus={() => setDurationDraft(String(duration))}
                        onChange={(e) => {
                          const text = e.target.value;
                          setDurationDraft(text);
                          const value = Number(text);
                          if (
                            text !== "" &&
                            Number.isFinite(value) &&
                            value >= 4 &&
                            (currentModel !== "seedance-2" ||
                              Number.isInteger(value)) &&
                            value <=
                              Math.min(
                                modelProfile.maxDuration,
                                (currentSource.duration ?? 4) - start,
                              )
                          )
                            setDuration(value);
                        }}
                        onBlur={() => {
                          applyClip();
                        }}
                      />
                      <span>s</span>
                    </label>
                  </div>
                  <Slider
                    aria-label="Select clip length"
                    min={4}
                    max={Math.max(
                      4 + modelProfile.durationStep,
                      maxEnd - currentStart,
                    )}
                    step={modelProfile.durationStep}
                    value={[currentDuration]}
                    onValueChange={(values) =>
                      setDuration(
                        clampClipDuration(
                          values[0],
                          currentModel,
                          Math.max(4, (currentSource.duration ?? 4) - start),
                        ),
                      )
                    }
                    disabled={
                      inputsDisabled ||
                      (currentSource.duration ?? 4) - currentStart <= 4
                    }
                  />
                </div>
              )}
              <div className="field-heading direction-heading">
                <label htmlFor="prompt">
                  {currentWorkflow === "restyle"
                    ? "Custom direction"
                    : "Your direction"}
                </label>
                <span>
                  <WandSparkles size={12} />
                  Describe the change
                </span>
              </div>
              <div className="direction-input">
                <Textarea
                  id="prompt"
                  aria-label="Generation prompt"
                  {...form.register("prompt")}
                  value={active?.prompt ?? prompt}
                  disabled={inputsDisabled}
                  placeholder={workflows[currentWorkflow].placeholder}
                  maxLength={3000}
                />
                <div>
                  <span>{(active?.prompt ?? prompt).length}/3000</span>
                  <button
                    aria-label="Reset prompt"
                    title="Reset prompt"
                    type="button"
                    disabled={inputsDisabled}
                    onClick={() =>
                      form.setValue("prompt", swap ? defaultPrompt : "", {
                        shouldValidate: true,
                      })
                    }
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              </div>
              <PromptEnhancer
                key={`${mode}:${selectedId ?? `draft-${draftSession}`}`}
                prompt={active?.prompt ?? prompt}
                model={currentModel}
                workflow={currentWorkflow}
                operation={currentOperation}
                stylePreset={currentStylePreset}
                references={swap ? [] : currentReferences}
                target={options?.target ?? target}
                prepareImage={currentPrepareImage}
                preserveAudio={currentPreserveAudio}
                disabled={inputsDisabled || mediaBusy}
                available={capabilities.data?.promptEnhancement ?? false}
                apiClient={apiClient}
                scenario={demo ? scenario : undefined}
                onBusyChange={setEnhancingPrompt}
                onApply={(next, expected) => {
                  if (active || form.getValues("prompt") !== expected)
                    return false;
                  form.setValue("prompt", next, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                  return true;
                }}
              />
              {form.formState.errors.prompt && (
                <p className="field-error" role="alert">
                  {form.formState.errors.prompt.message}
                </p>
              )}
              {!active && (
                <div className="prompt-suggestions">
                  <button
                    disabled={inputsDisabled || mediaBusy}
                    onClick={() =>
                      form.setValue(
                        "prompt",
                        prompt + " Keep the original outfit.",
                      )
                    }
                  >
                    Keep outfit
                    <Plus size={10} />
                  </button>
                  <button
                    disabled={inputsDisabled || mediaBusy}
                    onClick={() =>
                      form.setValue(
                        "prompt",
                        prompt + " Preserve the original background.",
                      )
                    }
                  >
                    Keep background
                    <Plus size={10} />
                  </button>
                </div>
              )}
              {(swap || currentWorkflow === "element_edit") && (
                <div className="subject-control">
                  <div className="subject-field">
                    <label htmlFor="target">
                      {swap ? "Subject to replace" : "Edit target"}
                    </label>
                    <Input
                      id="target"
                      aria-label={swap ? "Subject to replace" : "Edit target"}
                      aria-describedby="target-guidance"
                      value={options?.target ?? target}
                      onChange={(e) => setTarget(e.target.value)}
                      disabled={inputsDisabled}
                      placeholder={
                        swap
                          ? "e.g. person in a black jacket"
                          : "e.g. the jacket, sign, or background"
                      }
                      maxLength={160}
                    />
                  </div>
                  <p id="target-guidance" className="subject-guidance">
                    {swap
                      ? "Match the source person: “person in a black jacket”. One short phrase; clothing works better than left/right."
                      : "Name the element or location to edit. Describe what changes and what stays in your direction."}
                  </p>
                </div>
              )}
              <div className="quality-row">
                <Select
                  value={currentModel}
                  disabled={inputsDisabled || mediaBusy || !swap}
                  onValueChange={(value) => {
                    const nextModel = value as VideoModelId;
                    const { duration: nextDuration } = applyClip(
                      Number(startDraft ?? start),
                      Number(durationDraft ?? duration),
                      nextModel,
                    );
                    setModel(nextModel);
                    setDuration(nextDuration);
                    setDurationDraft(null);
                    if (nextDuration !== duration)
                      toast.info(
                        `Clip adjusted to ${nextDuration}s for ${videoModels[nextModel].label}.`,
                      );
                  }}
                >
                  <SelectTrigger
                    className="model-picker-trigger"
                    aria-label="Video model"
                    aria-describedby="model-guidance"
                  >
                    <BytePlusMark size={16} />
                    <SelectValue>{modelProfile.label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent
                    className="model-picker-menu"
                    position="popper"
                    align="start"
                    sideOffset={7}
                  >
                    <SelectGroup>
                      <SelectLabel>Video model</SelectLabel>
                      {videoModelIds.map((id) => (
                        <SelectItem
                          key={id}
                          value={id}
                          textValue={videoModels[id].label}
                          className="model-picker-option"
                        >
                          <span className="model-option-copy">
                            <span className="model-option-title">
                              {videoModels[id].label}
                              <span>4–{videoModels[id].maxDuration}s</span>
                            </span>
                            <span className="model-option-description">
                              {videoModels[id].description}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <select
                  aria-label="Output resolution"
                  value={options?.resolution ?? resolution}
                  onChange={(e) =>
                    setResolution(e.target.value as typeof resolution)
                  }
                  disabled={inputsDisabled}
                >
                  <option value="480p">480p · Draft</option>
                  <option value="720p">720p · HD</option>
                  <option value="1080p">1080p · Full HD</option>
                </select>
              </div>
              <p className="model-guidance" id="model-guidance">
                {currentModel === "seedance-2"
                  ? "4–15s · whole-second clips · reference generation"
                  : swap
                    ? "4–30s · dedicated video editing"
                    : "Seedance 2.5 required · original video, no subject mask"}
              </p>
              <fieldset
                className="audio-setting"
                disabled={inputsDisabled}
                aria-describedby="output-audio-description"
              >
                <legend>
                  <Volume2 size={13} aria-hidden="true" />
                  Output audio
                </legend>
                <div className="audio-choices">
                  <label>
                    <input
                      type="radio"
                      name="output-audio"
                      value="source"
                      className="sr-only"
                      checked={currentPreserveAudio}
                      onChange={() => setPreserveAudio(true)}
                    />
                    <span>Keep original</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="output-audio"
                      value="generated"
                      className="sr-only"
                      checked={!currentPreserveAudio}
                      onChange={() => setPreserveAudio(false)}
                    />
                    <span>Generate new</span>
                  </label>
                </div>
                <p id="output-audio-description">
                  {currentPreserveAudio
                    ? "Use the source soundtrack in the finished video."
                    : "Seedance creates new dialogue and sound."}
                </p>
              </fieldset>
              {swap && (
                <button
                  className="advanced-toggle"
                  aria-expanded={advanced}
                  onClick={() => setAdvanced(!advanced)}
                >
                  <Settings2 size={13} />
                  Advanced settings
                  <span>
                    <ChevronDown
                      size={14}
                      className={cn(advanced && "rotated")}
                    />
                  </span>
                </button>
              )}
              {swap && advanced && (
                <div className="advanced-options">
                  <div className="toggle-setting">
                    <div>
                      <strong>
                        <Sparkles size={13} />
                        Prepare the scene look
                      </strong>
                      <p>
                        {capabilities.data?.image
                          ? "Optional · preview your character in the scene."
                          : `Optional · ${SEEDREAM_NAME} needs setup.`}
                      </p>
                    </div>
                    <Switch
                      aria-label="Prepare the scene look"
                      checked={currentPrepareImage}
                      onCheckedChange={setPrepareImage}
                      disabled={inputsDisabled || !capabilities.data?.image}
                    />
                  </div>
                </div>
              )}
              {active && (
                <button
                  className="subtle-button new-inputs"
                  onClick={() => fresh()}
                  disabled={
                    pending || cancel.isPending || mediaBusy || enhancingPrompt
                  }
                >
                  <Plus size={13} />
                  Start with new inputs
                </button>
              )}
            </div>
            <div className="control-footer">
              {primary}
              <p aria-live="polite">{guidance}</p>
              {!demo && demoAvailable && (
                <Link className="explore-preview" href="/preview">
                  Open sample workspace
                  <ArrowRight size={12} />
                </Link>
              )}
            </div>
          </section>
          <main className="studio-workspace" id="workspace">
            {demo && (
              <p className="review-disclaimer" role="note">
                Sample workspace: processing is simulated and results are
                prerecorded. Your direction does not change the sample video.
              </p>
            )}
            <div className="workspace-heading">
              <h2>{workspaceTitle}</h2>
              {active &&
              (!terminal(active.status) ||
                active.status === "awaiting_approval") ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => cancel.mutate(active.id)}
                  disabled={stopping}
                >
                  {stopping ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <X size={13} />
                  )}
                  Cancel take
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fresh()}
                  disabled={pending || mediaBusy || enhancingPrompt}
                >
                  <Plus size={14} />
                  New take
                </Button>
              )}
            </div>
            {capabilities.isError && (
              <div className="workspace-error" role="alert">
                <strong>The studio couldn’t connect.</strong>
                <p>{capabilities.error.message}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void capabilities.refetch()}
                >
                  Try again
                </Button>
              </div>
            )}
            {generation.isError && (
              <div className="workspace-error" role="alert">
                <strong>This take couldn’t load.</strong>
                <p>{generation.error.message}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void generation.refetch()}
                >
                  Try again
                </Button>
              </div>
            )}
            {view === "library" ? (
              <Library
                jobs={history.data ?? []}
                loading={history.isLoading}
                error={history.error?.message}
                onRetry={() => void history.refetch()}
                onSelect={select}
                onNew={fresh}
                newDisabled={
                  pending || cancel.isPending || mediaBusy || enhancingPrompt
                }
              />
            ) : selectedId && generation.isLoading ? (
              <div className="workspace-skeleton" role="status">
                <div />
                <p>
                  <Loader2 size={15} className="animate-spin" />
                  Loading your saved take…
                </p>
              </div>
            ) : (
              <>
                {currentSource ? (
                  <div className={cn("take-workspace", active && "has-take")}>
                    <MediaCanvas
                      source={currentSource}
                      job={active}
                      start={currentStart}
                      duration={currentDuration}
                      tab={tab}
                      onTab={setTab}
                    />
                    {active ? (
                      <RunDetails
                        job={active}
                        onApprove={() => approve.mutate(active.id)}
                        onReuse={reuse}
                        onCancel={() => cancel.mutate(active.id)}
                        approving={approve.isPending}
                        cancelling={stopping}
                        reuseDisabled={
                          pending ||
                          cancel.isPending ||
                          mediaBusy ||
                          enhancingPrompt
                        }
                      />
                    ) : (
                      <div className="input-ready-note">
                        <span>
                          <Check size={15} />
                          {inputsReady
                            ? "Your references are ready."
                            : "Your performance is ready."}
                        </span>
                        <p>
                          {inputsReady
                            ? "Set the direction, then prepare your references for a quick review."
                            : inputIssue}
                        </p>
                        <button
                          className="mobile-only-text"
                          onClick={() => setMobilePanel("inputs")}
                        >
                          Back to inputs
                          <ArrowRight size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <ExampleCanvas
                    onSample={trySample}
                    samplePending={sample.isPending}
                    sampleDisabled={mediaBusy || pending || enhancingPrompt}
                    canTry={demo || demoAvailable}
                  />
                )}
              </>
            )}
            <footer className="canvas-footer">
              <button onClick={() => setHelpOpen(true)}>
                How it works
                <ArrowUpRight size={12} />
              </button>
            </footer>
          </main>
        </div>
        <div className="mobile-action-footer">
          {primary}
          <p aria-live="polite">{guidance}</p>
        </div>
      </div>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="connections-dialog">
          <DialogTitle>{settingsLabel}</DialogTitle>
          {demo ? (
            <>
              <DialogDescription className="sr-only">
                Choose the outcome for the next sample take.
              </DialogDescription>
              <label className="sample-outcome">
                <span>Sample outcome</span>
                <select
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value as DemoScenario)}
                  disabled={busy || pending}
                >
                  <option value="success">Successful take</option>
                  <option value="failure">Provider failure</option>
                </select>
              </label>
              <Button variant="outline" asChild>
                <Link href="/">
                  Open live studio
                  <ArrowRight size={14} />
                </Link>
              </Button>
            </>
          ) : (
            <>
              <DialogDescription>
                Configure these services in your local environment, then restart
                the studio and worker.
              </DialogDescription>
              <div className="connections-list">
                {[
                  {
                    name: modelProfile.label,
                    description: "Video generation · BytePlus ModelArk",
                    ready: capabilities.data?.video,
                  },
                  {
                    name: "Meta SAM 3.1",
                    description: swap
                      ? "Subject tracking · Meta Model API"
                      : "Character swaps only · not needed for this workflow",
                    ready: capabilities.data?.sam,
                    optional: !swap,
                  },
                  {
                    name: "Virtual Portrait",
                    description: "Video reference registration",
                    ready: capabilities.data?.portraits,
                  },
                  {
                    name: "BytePlus TOS",
                    description: "Private source files and finished videos",
                    ready: capabilities.data?.storage,
                  },
                  {
                    name: SEEDREAM_NAME,
                    description: "Optional scene-image preparation",
                    ready: capabilities.data?.image,
                  },
                  {
                    name: "Prompt enhancement",
                    description:
                      "Optional · refine your direction before generation",
                    ready: capabilities.data?.promptEnhancement,
                  },
                  {
                    name: "Processing worker",
                    description: "Background processing and saved progress",
                    ready: !!capabilities.data?.workerSeenAt,
                  },
                ].map((item) => (
                  <div key={item.name}>
                    <span
                      className={cn("connection-symbol", item.ready && "ready")}
                    >
                      {item.ready ? (
                        <Check size={15} />
                      ) : (
                        <Settings2 size={15} />
                      )}
                    </span>
                    <div>
                      <strong>{item.name}</strong>
                      <p>{item.description}</p>
                    </div>
                    <span className="connection-state">
                      {item.ready
                        ? "Configured"
                        : item.optional
                          ? "Not needed"
                          : "Needs setup"}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="help-dialog">
          <DialogTitle>New take. Same source.</DialogTitle>
          <DialogDescription>
            Three moments from the original clip to your next take.
          </DialogDescription>
          <ol className="help-steps">
            <li>
              <span>01</span>
              <div>
                <strong>Bring your references</strong>
                <p>
                  {swap
                    ? "Add a performance and character image."
                    : "Add a source video and any needed reference images."}{" "}
                  Choose 4–
                  {modelProfile.maxDuration} seconds and describe what changes.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Check the look</strong>
                <p>
                  {swap
                    ? "Review the tracked subject and optional scene image."
                    : "Review the prepared original video and ordered images. No subject mask is used."}{" "}
                  You approve the references before video generation.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Create and compare</strong>
                <p>
                  Review the finished take beside your source, check the timing
                  and appearance, then download.
                </p>
              </div>
            </li>
          </ol>
          <p className="dialog-footnote">
            {swap ? "A prepared scene image is optional. " : ""}References guide
            the result; review every take before sharing.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

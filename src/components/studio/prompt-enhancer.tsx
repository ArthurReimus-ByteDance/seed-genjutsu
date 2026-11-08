"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Check,
  Loader2,
  RotateCcw,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { type DemoScenario, type StudioApi } from "@/lib/api";
import {
  enhancePromptRequestSchema,
  type EnhancePromptRequest,
} from "@/lib/prompt-enhancement";
import { type VideoModelId } from "@/lib/video-models";

type Props = {
  prompt: string;
  model: VideoModelId;
  target: string;
  prepareImage: boolean;
  preserveAudio: boolean;
  disabled: boolean;
  available: boolean;
  apiClient: StudioApi;
  scenario?: DemoScenario;
  onApply: (prompt: string, expectedPrompt: string) => boolean;
  onBusyChange: (busy: boolean) => void;
};
type Call = {
  input: EnhancePromptRequest;
  expectedPrompt: string;
  original: string;
  abort: AbortController;
  id: number;
};

export function PromptEnhancer({
  prompt,
  model,
  target,
  prepareImage,
  preserveAudio,
  disabled,
  available,
  apiClient,
  scenario,
  onApply,
  onBusyChange,
}: Props) {
  const [applied, setApplied] = useState<{
    original: string;
    text: string;
    simulated: boolean;
  } | null>(null);
  const [message, setMessage] = useState<{
    kind: "error" | "info";
    text: string;
    forPrompt: string;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const current = useRef({
    prompt,
    model,
    target,
    prepareImage,
    preserveAudio,
    disabled,
  });
  useLayoutEffect(() => {
    current.current = {
      prompt,
      model,
      target,
      prepareImage,
      preserveAudio,
      disabled,
    };
  });
  useEffect(
    () => () => {
      requestId.current++;
      controller.current?.abort();
      onBusyChange(false);
    },
    [onBusyChange],
  );

  const mutation = useMutation({
    mutationFn: (call: Call) =>
      apiClient.enhancePrompt(call.input, {
        signal: call.abort.signal,
        scenario,
      }),
    retry: false,
    onSuccess: (result, call) => {
      if (call.id !== requestId.current || call.abort.signal.aborted) return;
      onBusyChange(false);
      const latest = current.current;
      if (
        latest.disabled ||
        latest.prompt !== call.expectedPrompt ||
        latest.model !== call.input.model ||
        (latest.target.trim() || "person") !== call.input.target ||
        latest.prepareImage !== call.input.prepareImage ||
        latest.preserveAudio !== call.input.preserveAudio ||
        !onApply(result.prompt, call.expectedPrompt)
      ) {
        setMessage({
          kind: "info",
          text: "Kept your newer edits or settings. Enhance again when you're ready.",
          forPrompt: latest.prompt,
        });
        return;
      }
      setApplied({
        original: call.original,
        text: result.prompt,
        simulated: result.simulated,
      });
    },
    onError: (error, call) => {
      if (call.id !== requestId.current || call.abort.signal.aborted) return;
      onBusyChange(false);
      setMessage({
        kind: "error",
        forPrompt: current.current.prompt,
        text:
          error instanceof Error
            ? error.message
            : "Couldn't enhance this prompt. Try again.",
      });
    },
  });
  const busy = mutation.isPending;
  const enhanced = !!applied && prompt === applied.text;
  const edited = !!applied && !enhanced;
  const canEnhance =
    available &&
    !disabled &&
    prompt.trim().length >= 3 &&
    prompt.length <= 3000;

  function run() {
    const original = enhanced && applied ? applied.original : prompt;
    const input = {
      prompt: original,
      model,
      target: target.trim() || "person",
      prepareImage,
      preserveAudio,
      ...(enhanced && applied ? { previousPrompt: applied.text } : {}),
    };
    if (!enhancePromptRequestSchema.safeParse(input).success) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setMessage(null);
    onBusyChange(true);
    mutation.mutate({
      input,
      original,
      expectedPrompt: prompt,
      abort,
      id: ++requestId.current,
    });
  }
  function cancel() {
    requestId.current++;
    controller.current?.abort();
    mutation.reset();
    onBusyChange(false);
    setMessage({
      kind: "info",
      text: "Enhancement cancelled. Your text is unchanged.",
      forPrompt: current.current.prompt,
    });
  }

  return (
    <div className="prompt-enhance-inline">
      <div className="prompt-enhance-toolbar">
        <span
          className="prompt-enhance-status"
          role="status"
          aria-live="polite"
        >
          {!busy && enhanced && (
            <>
              <Check size={11} /> Enhanced
              {applied.simulated && <small>Preview</small>}
            </>
          )}
          {!busy && edited && (
            <>
              <Sparkles size={11} /> Edited
            </>
          )}
          {busy && "Refining your direction…"}
        </span>
        <span className="prompt-enhance-actions">
          {busy && (
            <button
              type="button"
              className="prompt-enhance-secondary"
              onClick={cancel}
            >
              <X size={11} /> Cancel
            </button>
          )}
          {!busy && enhanced && !disabled && (
            <button
              type="button"
              className="prompt-enhance-secondary"
              aria-label="Undo prompt enhancement"
              onClick={() => {
                if (applied && onApply(applied.original, prompt)) {
                  setApplied(null);
                  setMessage(null);
                }
              }}
            >
              <RotateCcw size={11} /> Undo
            </button>
          )}
          <button
            type="button"
            className="prompt-enhance-trigger"
            aria-label={
              enhanced ? "Retry prompt enhancement" : "Enhance prompt"
            }
            disabled={!canEnhance || busy}
            title={
              !available
                ? "Connect ModelArk in Studio connections to enhance prompts."
                : prompt.trim().length < 3
                  ? "Add a few words to enhance."
                  : enhanced
                    ? "Try a different wording of your original direction."
                    : "Refine your direction in this field."
            }
            onClick={run}
          >
            {busy ? (
              <Loader2 size={12} className="animate-spin" />
            ) : enhanced ? (
              <RotateCcw size={12} />
            ) : (
              <WandSparkles size={12} />
            )}
            {busy ? "Enhancing…" : enhanced ? "Retry" : "Enhance prompt"}
          </button>
        </span>
      </div>
      {message && message.forPrompt === prompt && (
        <p
          className={
            "prompt-enhance-message " +
            (message.kind === "error" ? "is-error" : "")
          }
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

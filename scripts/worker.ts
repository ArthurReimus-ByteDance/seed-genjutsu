import { loadEnvironment } from "./environment.mjs";
loadEnvironment();

async function main() {
  const { APP_NAME, DOWNLOAD_PREFIX } = await import("../src/lib/branding");
  const { providerModelId } = await import("../src/server/video-models");
  const { env } = await import("../src/env");
  const { workspace, workerHeartbeat } =
    await import("../src/server/workspace");
  const {
    jobRecord,
    event,
    transition,
    finishPreparation,
    updateJob,
    claimJob,
    renewLease,
    completeProviderStage,
    validateSubmission,
  } = await import("../src/server/jobs");
  const { getMedia, localPath, providerUrl, saveMedia } =
    await import("../src/server/storage");
  const { trimVideo, frame, probe, restoreAudio } =
    await import("../src/server/media");
  const {
    arkAction,
    modelArk,
    seedreamRequest,
    seedanceRequest,
    downloadProviderMedia,
    ProviderError,
  } = await import("../src/server/providers");
  const { segmentVideo, samVideoDataUrl, samCheckpointStore, parseSavedMasks } =
    await import("../src/server/meta-sam");
  const { renderMaskedVideo } = await import("../src/server/sam-render");
  const { AppError } = await import("../src/server/http");
  const { randomUUID } = await import("node:crypto");
  const { writeFile, rm } = await import("node:fs/promises");
  const { default: path } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const id = randomUUID();
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });
  const heartbeat = setInterval(() => {
    void workerHeartbeat(id).catch(() => {});
  }, 5000);
  async function delayJob(jobId: string, seconds = 8) {
    await updateJob(jobId, {
      next_run_at: Date.now() + seconds * 1000,
    });
  }
  async function markSubmission(jobId: string) {
    await workspace.update((state) => {
      const job = state.jobs[jobId];
      if (
        job.cancel_requested ||
        job.lease_owner !== id ||
        !job.lease_until ||
        job.lease_until <= Date.now()
      )
        throw new AppError(
          409,
          "CANCELLED",
          "This take was cancelled or its worker lease ended.",
        );
      job.submission_started_at = new Date().toISOString();
    });
  }
  async function clearSubmission(jobId: string) {
    await updateJob(jobId, { submission_started_at: null });
  }
  async function step(jobId: string, signal: AbortSignal) {
    const job = await jobRecord(jobId);
    const config = job.config;
    const swap = config.workflow === "character_swap";
    if (job.cancel_requested) {
      if (job.provider_task_id)
        await fetch(
          env.BYTEPLUS_BASE_URL +
            "/contents/generations/tasks/" +
            encodeURIComponent(job.provider_task_id),
          {
            method: "DELETE",
            headers: { Authorization: "Bearer " + env.BYTEPLUS_API_KEY },
            signal: AbortSignal.timeout(10000),
          },
        ).catch(() => {});
      await updateJob(job.id, {
        status: "cancelled",
        stage: "cancelled",
        lease_until: null,
        lease_owner: null,
      });
      return;
    }
    const recovered =
      job.stage === "submitting" && job.provider_task_id
        ? { kind: "task" as const, id: job.provider_task_id }
        : job.stage === "registering" && job.asset_id
          ? { kind: "asset" as const, id: job.asset_id }
          : job.stage === "generating" && job.result_id
            ? { kind: "result" as const, id: job.result_id }
            : null;
    if (recovered) {
      await completeProviderStage(job.id, id, recovered);
      return;
    }
    const checkpoint =
      swap && job.stage === "masking"
        ? await samCheckpointStore(job.id).read((state) => state.response)
        : null;
    if (job.submission_started_at && !checkpoint)
      throw new ProviderError(
        "A provider submission was interrupted before its result was saved. Review the provider dashboard before starting a new generation.",
        true,
      );
    const source = await getMedia(job.source_id);
    if (job.stage === "queued") {
      if (!swap && job.prepared_id && job.frame_id) {
        await finishPreparation(
          job,
          "Your prepared clip is ready. Review it before video generation.",
          id,
        );
        return;
      }
      await event(
        job.id,
        "preparing",
        "Preparing the selected clip and its first frame.",
      );
      await updateJob(job.id, { status: "processing", progress: 5 });
      const prepared = await trimVideo(
        await localPath(source),
        config.start,
        config.duration,
        signal,
      );
      try {
        const image = await frame(prepared.file);
        const frameMedia = await saveMedia({
          kind: "frame",
          name: "First frame",
          mime: "image/jpeg",
          ...image,
        });
        const video = await saveMedia({
          kind: "prepared",
          name: "Prepared source",
          mime: "video/mp4",
          data: prepared.data,
          ...prepared.meta,
        });
        await updateJob(job.id, {
          frame_id: frameMedia.id,
          prepared_id: video.id,
        });
      } finally {
        await rm(prepared.dir, { recursive: true, force: true });
      }
      if (!swap) {
        await finishPreparation(
          job,
          "Your prepared clip is ready. Review it before video generation.",
          id,
        );
        return;
      }
      await transition(
        job.id,
        "processing",
        "masking",
        15,
        "Source prepared. Tracking the selected subject with Meta SAM 3.1.",
        id,
      );
      return;
    }
    if (job.stage === "masking") {
      if (!swap)
        throw new AppError(
          400,
          "INVALID_STAGE",
          "This workflow does not use subject masking.",
        );
      if (!job.masked_id) {
        if (job.sam_request_id)
          throw new ProviderError(
            "This take has an earlier fal.ai submission. Review it in fal.ai before creating a new Meta SAM take.",
            true,
          );
        let saved = checkpoint;
        if (!saved && job.meta_response_id)
          throw new ProviderError(
            "This Meta response has no completed local mask checkpoint. Check Meta usage before starting another take.",
            true,
          );
        if (!saved && !env.META_API_KEY)
          throw new AppError(
            503,
            "META_SETUP",
            "SAM 3.1 needs your Meta Model API key. Add META_API_KEY, restart the server and worker, then create a new take.",
          );
        const prepared = await getMedia(job.prepared_id!);
        if (!saved) {
          // Meta's fetch service can reject otherwise valid signed TOS URLs.
          // Send a video-only copy inline and keep the prepared soundtrack for finishing.
          const url = await samVideoDataUrl(await localPath(prepared), signal);
          await markSubmission(job.id);
          try {
            const { result, responseId } = await segmentVideo(
              url,
              config.target,
              signal,
              {
                onResponseId: async (responseId) => {
                  await updateJob(job.id, { meta_response_id: responseId });
                },
              },
            );
            saved = { responseId, output: result.rawOutput };
            await samCheckpointStore(job.id).update((state) => {
              state.response = saved;
            });
          } catch (error) {
            // A confirmed rejection can be retried safely (429); unknown POSTs cannot.
            if (error instanceof ProviderError && !error.ambiguous)
              await clearSubmission(job.id);
            throw error;
          }
        }
        // A completed checkpoint also recovers a crash between these two writes.
        await updateJob(job.id, {
          meta_response_id: saved.responseId,
          submission_started_at: null,
          progress: 25,
        });
        await event(
          job.id,
          "masking",
          "Meta masks received. Rendering the subject silhouette while preserving the scene.",
        );
        const rendered = await renderMaskedVideo(
          await localPath(prepared),
          parseSavedMasks(saved.output),
          signal,
        );
        try {
          const masked = await saveMedia({
            kind: "masked",
            name: "Masked performance",
            mime: "video/mp4",
            data: rendered.data,
            ...rendered.meta,
          });
          await updateJob(job.id, { masked_id: masked.id });
        } finally {
          await rm(rendered.dir, { recursive: true, force: true });
        }
      }
      if (config.prepareImage)
        await transition(
          job.id,
          "processing",
          "image_preparation",
          35,
          "Masked video ready. Preparing the character in your scene.",
          id,
        );
      else
        await finishPreparation(
          job,
          "Masked performance is ready. Review it before video generation.",
          id,
        );
      return;
    }
    if (job.stage === "image_preparation") {
      if (!swap)
        throw new AppError(
          400,
          "INVALID_STAGE",
          "Scene-image preparation is unavailable for this workflow.",
        );
      const reviewMessage =
        "Your scene image is ready. Approve the references to generate the video.";
      if (job.anchor_id) {
        await finishPreparation(job, reviewMessage, id);
        return;
      }
      if (!env.SEEDREAM_MODEL)
        throw new AppError(
          503,
          "IMAGE_SETUP",
          "Configure a verified Seedream model ID before preparing the scene image.",
        );
      const frameMedia = await getMedia(job.frame_id!);
      const { character } = await validateSubmission(job.id, false);
      if (!character)
        throw new AppError(
          400,
          "INVALID_INPUT",
          "The character image is missing.",
        );
      const [frameUrl, characterUrl] = await Promise.all([
        providerUrl(frameMedia),
        providerUrl(character),
      ]);
      await markSubmission(job.id);
      const result = await modelArk(
        "/images/generations",
        seedreamRequest({
          providerModel: env.SEEDREAM_MODEL,
          characterUrl,
          frameUrl,
          target: config.target,
          prompt: config.prompt,
        }),
        signal,
      );
      const entries = result.data as { url?: string; b64_json?: string }[];
      const first = entries?.[0];
      if (!first?.url && !first?.b64_json)
        throw new ProviderError("The image provider returned no image.", true);
      const data = first.b64_json
        ? Buffer.from(first.b64_json, "base64")
        : await downloadProviderMedia(first.url!, 30 * 1024 * 1024);
      const image = await (
        await import("../src/server/media")
      ).normalizeImage(data);
      const anchor = await saveMedia({
        kind: "anchor",
        name: "Prepared scene image",
        mime: "image/jpeg",
        ...image,
      });
      await updateJob(job.id, {
        anchor_id: anchor.id,
        submission_started_at: null,
      });
      await finishPreparation(job, reviewMessage, id);
      return;
    }
    if (job.stage === "registering") {
      const { registration } = await validateSubmission(job.id);
      if (!env.BYTEPLUS_ACCESS_KEY || !env.BYTEPLUS_SECRET_KEY)
        throw new AppError(
          503,
          "PORTRAIT_SETUP",
          "Connect your Virtual Portrait AK/SK to register the prepared video reference.",
        );
      if (!job.asset_group_id) {
        let groupId =
          env.BYTEPLUS_ASSET_GROUP ??
          (await workspace.read((state) => state.assetGroupId));
        if (!groupId) {
          await markSubmission(job.id);
          const group = await arkAction(
            "CreateAssetGroup",
            {
              Name: APP_NAME + " local studio",
              GroupType: "AIGC",
              Description: APP_NAME + " virtual portrait references",
            },
            signal,
          );
          groupId = String(group.Id);
          if (!groupId || groupId === "undefined")
            throw new ProviderError(
              "Virtual Portrait returned no group ID.",
              true,
            );
          await workspace.update((state) => {
            state.assetGroupId = groupId;
          });
          await clearSubmission(job.id);
        }
        await updateJob(job.id, { asset_group_id: groupId });
        await delayJob(job.id, 1);
        return;
      }
      const registrationUrl = await providerUrl(registration);
      await markSubmission(job.id);
      const asset = await arkAction(
        "CreateAsset",
        {
          GroupId: job.asset_group_id,
          URL: registrationUrl,
          AssetType: "Video",
          Name: APP_NAME + " " + job.id,
        },
        signal,
      );
      if (!asset.Id)
        throw new ProviderError("Virtual Portrait returned no asset ID.", true);
      await completeProviderStage(job.id, id, {
        kind: "asset",
        id: String(asset.Id),
      });
      return;
    }
    if (job.stage === "asset_review") {
      const asset = await arkAction("GetAsset", { Id: job.asset_id }, signal);
      if (asset.Status === "Failed")
        throw new ProviderError(
          "Virtual Portrait could not accept this reference. Review the prepared video and its asset eligibility.",
        );
      if (asset.Status !== "Active") {
        await delayJob(job.id, 10);
        return;
      }
      await transition(
        job.id,
        "processing",
        "submitting",
        65,
        "Your reference is active. Submitting the video transformation.",
        id,
      );
      return;
    }
    if (job.stage === "submitting") {
      const { character, anchor, references } = await validateSubmission(
        job.id,
      );
      if (!job.asset_id)
        throw new AppError(
          400,
          "MISSING_ASSET",
          "The registered video reference is missing.",
        );
      const providerModel =
        job.seedance_model_id ?? providerModelId(config.model);
      const videoUri = "asset://" + job.asset_id;
      let body: Record<string, unknown>;
      if (swap) {
        if (!character)
          throw new AppError(
            400,
            "INVALID_INPUT",
            "The character image is missing.",
          );
        body = seedanceRequest({
          model: config.model,
          providerModel,
          duration: config.duration,
          videoUri,
          characterUrl: await providerUrl(character),
          anchorUrl: anchor ? await providerUrl(anchor) : undefined,
          target: config.target,
          prompt: config.prompt,
          resolution: config.resolution,
          preserveAudio: config.preserveAudio,
        });
      } else {
        const { transformationRequest } =
          await import("../src/server/generation");
        body = transformationRequest({
          config,
          providerModel,
          videoUri,
          references: await Promise.all(
            references.map(async (reference) => ({
              role: reference.role,
              url: await providerUrl(reference.media),
            })),
          ),
        });
      }
      await markSubmission(job.id);
      const task = await modelArk("/contents/generations/tasks", body, signal);
      if (!task.id)
        throw new ProviderError("Seedance returned no task ID.", true);
      await completeProviderStage(job.id, id, {
        kind: "task",
        id: String(task.id),
      });
      await delayJob(job.id, 10);
      return;
    }
    if (job.stage === "generating") {
      const task = await modelArk(
        "/contents/generations/tasks/" +
          encodeURIComponent(job.provider_task_id!),
        undefined,
        signal,
      );
      if (["failed", "cancelled", "expired"].includes(String(task.status))) {
        const failure = task.error as
          { code?: unknown; Code?: unknown } | undefined;
        const code = String(failure?.code ?? failure?.Code ?? task.status)
          .replace(/[^a-zA-Z0-9_.-]/g, "")
          .slice(0, 100);
        throw new ProviderError(
          "Seedance could not complete this generation (" +
            code +
            "). Review model access, task support and reference eligibility before starting a new run.",
        );
      }
      if (task.status !== "succeeded") {
        await delayJob(job.id, 10);
        return;
      }
      const url = (task.content as { video_url?: string })?.video_url;
      if (!url)
        throw new ProviderError(
          "Seedance completed without a downloadable video.",
        );
      const data = await downloadProviderMedia(url);
      const file = path.join(tmpdir(), "recast-output-" + job.id + ".mp4");
      await writeFile(file, data);
      try {
        const prepared = await getMedia(job.prepared_id!);
        const delivered = config.preserveAudio
          ? await restoreAudio(file, await localPath(prepared), signal)
          : data;
        await writeFile(file, delivered);
        const meta = await probe(file);
        const result = await saveMedia({
          kind: "result",
          name: DOWNLOAD_PREFIX + "-" + job.id.slice(0, 8) + ".mp4",
          mime: "video/mp4",
          data: delivered,
          ...meta,
        });
        await completeProviderStage(job.id, id, {
          kind: "result",
          id: result.id,
        });
      } finally {
        await rm(file, { force: true });
      }
      return;
    }
    throw new Error("Unsupported job stage");
  }
  await workerHeartbeat(id);
  console.log(APP_NAME + " local worker started.");
  while (!stopping) {
    try {
      const jobId = await claimJob(id);
      if (!jobId) {
        await new Promise((resolve) => setTimeout(resolve, env.WORKER_POLL_MS));
        continue;
      }
      const controller = new AbortController();
      const lease = setInterval(() => {
        void renewLease(jobId, id)
          .then((active) => {
            if (!active) controller.abort();
          })
          .catch(() => controller.abort());
      }, 10000);
      try {
        await step(jobId, controller.signal);
      } catch (error) {
        const latest = await jobRecord(jobId);
        if (
          latest.lease_owner !== id ||
          !latest.lease_until ||
          latest.lease_until <= Date.now()
        )
          continue;
        if (latest.cancel_requested) {
          await updateJob(jobId, {
            status: "cancelled",
            stage: "cancelled",
            lease_until: null,
            lease_owner: null,
          });
        } else if (
          error instanceof ProviderError &&
          error.retryable &&
          !latest.submission_started_at
        ) {
          await delayJob(jobId, 30);
        } else {
          const ambiguous =
            (error instanceof ProviderError && error.ambiguous) ||
            !!latest.submission_started_at;
          const message =
            error instanceof AppError || error instanceof ProviderError
              ? error.message
              : "Processing could not finish. Check the worker configuration and try a new run.";
          await updateJob(jobId, {
            status: ambiguous ? "needs_attention" : "failed",
            error: message,
            lease_until: null,
            lease_owner: null,
          });
          await event(jobId, "failed", message);
        }
      } finally {
        clearInterval(lease);
        await workspace.update((state) => {
          const job = state.jobs[jobId];
          if (job?.lease_owner === id) {
            job.lease_until = null;
            job.lease_owner = null;
          }
        });
      }
    } catch (error) {
      console.error(
        "Worker could not read its queue:",
        error instanceof Error ? error.name : "unknown",
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  clearInterval(heartbeat);
  await workspace.update((state) => {
    delete state.workerHeartbeats[id];
  });
}
main().catch(() => {
  console.error("Worker startup failed.");
  process.exitCode = 1;
});

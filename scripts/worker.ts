import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

async function main() {
  const { env } = await import("../src/env");
  const { sql, pool } = await import("../src/server/db");
  const { jobRow, event, transition } = await import("../src/server/jobs");
  const { ownedMedia, localPath, providerUrl, saveMedia } =
    await import("../src/server/storage");
  const { trimVideo, frame, probe, restoreAudio } =
    await import("../src/server/media");
  const {
    arkAction,
    modelArk,
    seedanceRequest,
    downloadProviderMedia,
    ProviderError,
  } = await import("../src/server/providers");
  const { submitSam, samStatus, samResult, falClient } =
    await import("../src/server/fal");
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
    void sql(
      "INSERT INTO worker_heartbeats (id,seen_at) VALUES ($1,now()) ON CONFLICT (id) DO UPDATE SET seen_at=now()",
      [id],
    ).catch(() => {});
  }, 5000);
  async function delayJob(jobId: string, seconds = 8) {
    await sql(
      "UPDATE jobs SET next_run_at=now()+($2 * interval '1 second'),lease_until=NULL,lease_owner=NULL WHERE id=$1",
      [jobId, seconds],
    );
  }
  async function markSubmission(jobId: string) {
    await sql("UPDATE jobs SET submission_started_at=now() WHERE id=$1", [
      jobId,
    ]);
  }
  async function clearSubmission(jobId: string) {
    await sql("UPDATE jobs SET submission_started_at=NULL WHERE id=$1", [
      jobId,
    ]);
  }
  async function step(jobId: string, signal: AbortSignal) {
    const job = await jobRow(jobId);
    const config = job.config;
    if (job.cancel_requested) {
      if (job.sam_request_id)
        await falClient()
          .queue.cancel(env.FAL_SAM_ENDPOINT, { requestId: job.sam_request_id })
          .catch(() => {});
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
      await sql(
        "UPDATE jobs SET status='cancelled',stage='cancelled',lease_until=NULL,lease_owner=NULL,updated_at=now() WHERE id=$1",
        [job.id],
      );
      return;
    }
    if (job.submission_started_at)
      throw new ProviderError(
        "A provider submission was interrupted before its result was saved. Review the provider dashboard before starting a new generation.",
        true,
      );
    const source = await ownedMedia(job.source_id, job.user_id);
    if (job.stage === "queued") {
      await event(
        job.id,
        "preparing",
        "Preparing the selected clip and its first frame.",
      );
      await sql(
        "UPDATE jobs SET status='processing',progress=5,updated_at=now() WHERE id=$1",
        [job.id],
      );
      const prepared = await trimVideo(
        await localPath(source),
        config.start,
        config.duration,
        signal,
      );
      try {
        const image = await frame(prepared.file);
        const frameMedia = await saveMedia({
          userId: job.user_id,
          kind: "frame",
          name: "First frame",
          mime: "image/jpeg",
          ...image,
        });
        const video = await saveMedia({
          userId: job.user_id,
          kind: "prepared",
          name: "Prepared source",
          mime: "video/mp4",
          data: prepared.data,
          ...prepared.meta,
        });
        await sql("UPDATE jobs SET frame_id=$2,prepared_id=$3 WHERE id=$1", [
          job.id,
          frameMedia.id,
          video.id,
        ]);
      } finally {
        await rm(prepared.dir, { recursive: true, force: true });
      }
      await transition(
        job.id,
        "processing",
        "masking",
        15,
        "Source prepared. Finding the selected subject with SAM.",
      );
      return;
    }
    if (job.stage === "masking") {
      if (!job.sam_request_id) {
        if (!env.FAL_KEY)
          throw new AppError(
            503,
            "FAL_SETUP",
            "SAM processing needs your fal.ai endpoint and API key. Add FAL_KEY and FAL_SAM_ENDPOINT, then create a new run.",
          );
        const prepared = await ownedMedia(job.prepared_id!, job.user_id);
        const url = await providerUrl(prepared);
        await markSubmission(job.id);
        const task = await submitSam(url, config.target, signal);
        await sql(
          "UPDATE jobs SET sam_request_id=$2,submission_started_at=NULL WHERE id=$1",
          [job.id, task.request_id],
        );
        await delayJob(job.id);
        return;
      }
      const status = await samStatus(job.sam_request_id);
      if (status.status !== "COMPLETED") {
        await delayJob(job.id);
        return;
      }
      const data = await downloadProviderMedia(
        await samResult(job.sam_request_id),
      );
      const temp = path.join(tmpdir(), "recast-mask-" + job.id + ".mp4");
      await writeFile(temp, data);
      try {
        const meta = await probe(temp);
        const masked = await saveMedia({
          userId: job.user_id,
          kind: "masked",
          name: "Masked performance",
          mime: "video/mp4",
          data,
          ...meta,
        });
        await sql("UPDATE jobs SET masked_id=$2 WHERE id=$1", [
          job.id,
          masked.id,
        ]);
      } finally {
        await rm(temp, { force: true });
      }
      if (config.prepareImage)
        await transition(
          job.id,
          "processing",
          "image_preparation",
          35,
          "Masked video ready. Preparing the character in your scene.",
        );
      else
        await transition(
          job.id,
          "awaiting_approval",
          "review",
          45,
          "Masked performance is ready. Review it before video generation.",
        );
      return;
    }
    if (job.stage === "image_preparation") {
      if (!env.SEEDREAM_MODEL)
        throw new AppError(
          503,
          "IMAGE_SETUP",
          "Configure a verified Seedream model ID before preparing the scene image.",
        );
      const frameMedia = await ownedMedia(job.frame_id!, job.user_id);
      const character = await ownedMedia(job.character_id, job.user_id);
      const images = await Promise.all([
        providerUrl(frameMedia),
        providerUrl(character),
      ]);
      await markSubmission(job.id);
      const result = await modelArk(
        "/images/generations",
        {
          model: env.SEEDREAM_MODEL,
          image: images,
          prompt:
            "Replace the selected person in image 1 with the character in image 2, including their face, hair, body and complete outfit. Preserve image 1 pose, framing, background and lighting. " +
            config.prompt,
          response_format: "url",
          watermark: true,
        },
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
        userId: job.user_id,
        kind: "anchor",
        name: "Prepared scene image",
        mime: "image/jpeg",
        ...image,
      });
      await sql(
        "UPDATE jobs SET anchor_id=$2,submission_started_at=NULL WHERE id=$1",
        [job.id, anchor.id],
      );
      await transition(
        job.id,
        "awaiting_approval",
        "review",
        45,
        "Your scene image is ready. Approve the references to generate the video.",
      );
      return;
    }
    if (job.stage === "registering") {
      if (!env.BYTEPLUS_ACCESS_KEY || !env.BYTEPLUS_SECRET_KEY)
        throw new AppError(
          503,
          "PORTRAIT_SETUP",
          "Connect your Virtual Portrait AK/SK to register the masked performance video.",
        );
      if (!job.asset_group_id) {
        const users = await sql(
          "SELECT asset_group_id FROM users WHERE id=$1",
          [job.user_id],
        );
        let groupId = env.BYTEPLUS_ASSET_GROUP ?? users[0].asset_group_id;
        if (!groupId) {
          await markSubmission(job.id);
          const group = await arkAction(
            "CreateAssetGroup",
            {
              Name: "Recast " + job.user_id.slice(0, 8),
              GroupType: "AIGC",
              Description: "Recast Studio virtual portrait references",
            },
            signal,
          );
          groupId = String(group.Id);
          if (!groupId || groupId === "undefined")
            throw new ProviderError(
              "Virtual Portrait returned no group ID.",
              true,
            );
          await sql("UPDATE users SET asset_group_id=$2 WHERE id=$1", [
            job.user_id,
            groupId,
          ]);
          await clearSubmission(job.id);
        }
        await sql("UPDATE jobs SET asset_group_id=$2 WHERE id=$1", [
          job.id,
          groupId,
        ]);
        await delayJob(job.id, 1);
        return;
      }
      const masked = await ownedMedia(job.masked_id!, job.user_id);
      await markSubmission(job.id);
      const asset = await arkAction(
        "CreateAsset",
        {
          GroupId: job.asset_group_id,
          URL: await providerUrl(masked),
          AssetType: "Video",
          Name: "Recast " + job.id,
        },
        signal,
      );
      if (!asset.Id)
        throw new ProviderError("Virtual Portrait returned no asset ID.", true);
      await sql(
        "UPDATE jobs SET asset_id=$2,submission_started_at=NULL WHERE id=$1",
        [job.id, String(asset.Id)],
      );
      await transition(
        job.id,
        "processing",
        "asset_review",
        55,
        "Reference uploaded. Waiting for Virtual Portrait processing.",
      );
      return;
    }
    if (job.stage === "asset_review") {
      const asset = await arkAction("GetAsset", { Id: job.asset_id }, signal);
      if (asset.Status === "Failed")
        throw new ProviderError(
          "Virtual Portrait could not accept this reference. Review the masked video and its asset eligibility.",
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
        "Your reference is active. Submitting the Seedance edit.",
      );
      return;
    }
    if (job.stage === "submitting") {
      const character = await ownedMedia(job.character_id, job.user_id);
      const anchor = job.anchor_id
        ? await ownedMedia(job.anchor_id, job.user_id)
        : null;
      const body = seedanceRequest({
        videoUri: "asset://" + job.asset_id,
        characterUrl: await providerUrl(character),
        anchorUrl: anchor ? await providerUrl(anchor) : undefined,
        prompt: config.prompt,
        resolution: config.resolution,
      });
      await markSubmission(job.id);
      const task = await modelArk("/contents/generations/tasks", body, signal);
      if (!task.id)
        throw new ProviderError("Seedance returned no task ID.", true);
      await sql(
        "UPDATE jobs SET provider_task_id=$2,submission_started_at=NULL WHERE id=$1",
        [job.id, String(task.id)],
      );
      await transition(
        job.id,
        "generating",
        "generating",
        75,
        "Seedance is creating your character swap.",
      );
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
      if (["failed", "cancelled", "expired"].includes(String(task.status)))
        throw new ProviderError(
          "Seedance could not complete this generation. Review model access and reference eligibility before starting a new run.",
        );
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
        const prepared = await ownedMedia(job.prepared_id!, job.user_id);
        const delivered = config.preserveAudio
          ? await restoreAudio(file, await localPath(prepared), signal)
          : data;
        await writeFile(file, delivered);
        const meta = await probe(file);
        const result = await saveMedia({
          userId: job.user_id,
          kind: "result",
          name: "Recast-" + job.id.slice(0, 8) + ".mp4",
          mime: "video/mp4",
          data: delivered,
          ...meta,
        });
        await sql("UPDATE jobs SET result_id=$2 WHERE id=$1", [
          job.id,
          result.id,
        ]);
      } finally {
        await rm(file, { force: true });
      }
      await transition(
        job.id,
        "succeeded",
        "complete",
        100,
        "Your character swap is ready to review and download.",
      );
      return;
    }
    throw new Error("Unsupported job stage");
  }
  console.log("Recast worker started.");
  while (!stopping) {
    try {
      const jobs = await sql<{ id: string }>(
        "UPDATE jobs SET lease_owner=$1,lease_until=now()+interval '3 minutes',attempts=attempts+1 WHERE id=(SELECT id FROM jobs WHERE status IN ('queued','processing','generating') AND next_run_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id",
        [id],
      );
      if (!jobs.length) {
        await new Promise((resolve) => setTimeout(resolve, env.WORKER_POLL_MS));
        continue;
      }
      const jobId = jobs[0].id;
      const controller = new AbortController();
      const lease = setInterval(() => {
        void sql(
          "UPDATE jobs SET lease_until=now()+interval '3 minutes' WHERE id=$1 AND lease_owner=$2 RETURNING cancel_requested",
          [jobId, id],
        )
          .then((rows) => {
            if (rows[0]?.cancel_requested) controller.abort();
          })
          .catch(() => controller.abort());
      }, 10000);
      try {
        await step(jobId, controller.signal);
      } catch (error) {
        const latest = await jobRow(jobId);
        if (latest.cancel_requested) {
          await sql(
            "UPDATE jobs SET status='cancelled',stage='cancelled',lease_until=NULL,lease_owner=NULL,updated_at=now() WHERE id=$1",
            [jobId],
          );
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
          await sql(
            "UPDATE jobs SET status=$2,error=$3,lease_until=NULL,lease_owner=NULL,updated_at=now() WHERE id=$1",
            [jobId, ambiguous ? "needs_attention" : "failed", message],
          );
          await event(jobId, "failed", message);
        }
      } finally {
        clearInterval(lease);
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
  await sql("DELETE FROM worker_heartbeats WHERE id=$1", [id]);
  await pool.end();
}
main().catch(() => {
  console.error("Worker startup failed.");
  process.exitCode = 1;
});

export function assertSmokeTarget(instance, health, capabilities) {
  if (!instance || health.smokeInstance !== instance)
    throw new Error(
      "Smoke checks require the disposable instance owned by the harness.",
    );
  if (
    ["video", "image", "storage", "portraits", "sam", "promptEnhancement"].some(
      (capability) => capabilities[capability] !== false,
    )
  )
    throw new Error(
      "Smoke checks refuse a target with configured live providers.",
    );
}

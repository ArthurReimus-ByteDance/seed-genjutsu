import { z } from "zod";

export const DEFAULT_SAM_VERIFIER_MODEL = "deepseek-v4-1-flash-261017";
const subjectDescriptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^(?!.*(?:https?:|asset:|data:))[^\x00-\x1f<>{}]+$/i);
export const samRefinementDecisionSchema = z.object({
  decision: z.enum(["ready", "needs_review"]),
  reason: z.enum([
    "identified",
    "ambiguous_subject",
    "subject_not_found",
    "uncertain",
  ]),
  description: subjectDescriptionSchema.nullable(),
});
export const samRefinementSchema = samRefinementDecisionSchema.extend({
  model: z.string().min(1),
  originalTarget: z.string().min(1).max(160),
  preparedId: z.uuid(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  refinedAt: z.iso.datetime(),
});
export type SamRefinement = z.infer<typeof samRefinementSchema>;
export function usableSamRefinement(refinement: SamRefinement) {
  return (
    refinement.decision === "ready" &&
    refinement.reason === "identified" &&
    refinement.description !== null
  );
}
export const samRefinementReasons: Record<SamRefinement["reason"], string> = {
  identified: "The intended source subject was identified.",
  ambiguous_subject:
    "The description does not identify one clear source subject.",
  subject_not_found:
    "The described subject could not be found in the source clip.",
  uncertain: "The intended source subject could not be confirmed.",
};
export const maskAnalysisSchema = z.object({
  objects: z.number().int().nonnegative(),
  maskedFrames: z.number().int().nonnegative(),
  totalFrames: z.number().int().positive(),
  foregroundPixels: z.number().int().nonnegative(),
  minConfidence: z.number().min(0).max(1).nullable(),
  issue: z.enum(["empty_mask", "multiple_subjects"]).nullable(),
});
export const maskReviewSchema = z.object({
  decision: z.enum(["pass", "retry", "needs_review"]),
  reason: z.enum([
    "matched",
    "empty_mask",
    "multiple_subjects",
    "wrong_subject",
    "partial_mask",
    "uncertain",
  ]),
  subjectIdentified: z.boolean(),
  description: subjectDescriptionSchema.nullable(),
});
export const samVerificationSchema = maskReviewSchema.extend({
  model: z.string().min(1),
  attempt: z.number().int().min(1).max(2),
  target: z.string().min(1).max(160),
  maskedId: z.uuid(),
  comparisonId: z.uuid(),
  analysis: maskAnalysisSchema,
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  reviewedAt: z.iso.datetime(),
});
export type MaskAnalysis = z.infer<typeof maskAnalysisSchema>;
export type MaskReview = z.infer<typeof maskReviewSchema>;
export type SamVerification = z.infer<typeof samVerificationSchema>;

export const maskReviewReasons: Record<MaskReview["reason"], string> = {
  matched: "The mask follows the intended subject.",
  empty_mask: "No usable subject mask was found.",
  multiple_subjects: "More than one subject or tracking identity was selected.",
  wrong_subject: "The mask appears to select the wrong subject.",
  partial_mask: "The mask may omit important parts of the subject.",
  uncertain: "The intended subject or mask quality could not be confirmed.",
};

export function resolveMaskReview(
  review: MaskReview,
  analysis: MaskAnalysis,
  target: string,
  attempt: number,
): "pass" | "retry" | "stop" {
  if (!review.subjectIdentified) return "stop";
  if (
    review.decision === "pass" &&
    review.reason === "matched" &&
    review.description === null &&
    !analysis.issue &&
    analysis.objects === 1 &&
    analysis.foregroundPixels > 0 &&
    analysis.maskedFrames > 0 &&
    analysis.maskedFrames <= analysis.totalFrames
  )
    return "pass";
  const retryReason = analysis.issue ?? "wrong_subject";
  const normalize = (text: string) =>
    text.trim().replace(/\s+/g, " ").toLowerCase();
  if (
    review.decision === "retry" &&
    review.reason === retryReason &&
    attempt === 0 &&
    review.description &&
    normalize(review.description) !== normalize(target) &&
    normalize(review.description).length > 0
  )
    return "retry";
  return "stop";
}

export type ExtractorVariantId = "raw" | "editorial-pass-v1" | "editorial-pass-v2" | "single-pass";

export const EXTRACTOR_VARIANTS: ExtractorVariantId[] = [
  "raw",
  "editorial-pass-v1",
  "editorial-pass-v2",
  "single-pass"
];

export function isValidVariant(variant: string): variant is ExtractorVariantId {
  return EXTRACTOR_VARIANTS.includes(variant as ExtractorVariantId);
}

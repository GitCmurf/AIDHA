export const EXTRACTOR_VARIANTS = ["raw", "editorial-pass-v1", "editorial-pass-v2", "single-pass"] as const;

export type ExtractorVariantId = typeof EXTRACTOR_VARIANTS[number];

export const isValidVariant = (variant: string): variant is ExtractorVariantId => {
  return (EXTRACTOR_VARIANTS as readonly string[]).includes(variant);
};

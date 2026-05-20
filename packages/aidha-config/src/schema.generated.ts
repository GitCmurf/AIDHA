// @ts-nocheck
/* eslint-disable */
/**
 * This file was automatically generated.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run `pnpm gen:types` to regenerate this file.
 */

export const PATH_PATTERNS: string[][] = [
  [
    "base_dir"
  ],
  [
    "profiles",
    "*",
    "db"
  ],
  [
    "profiles",
    "*",
    "llm",
    "cache_dir"
  ],
  [
    "profiles",
    "*",
    "export",
    "out_dir"
  ],
  [
    "profiles",
    "*",
    "source_overrides",
    "*",
    "db"
  ],
  [
    "profiles",
    "*",
    "source_overrides",
    "*",
    "llm",
    "cache_dir"
  ],
  [
    "profiles",
    "*",
    "source_overrides",
    "*",
    "export",
    "out_dir"
  ],
  [
    "sources",
    "*",
    "db"
  ],
  [
    "sources",
    "*",
    "llm",
    "cache_dir"
  ],
  [
    "sources",
    "*",
    "export",
    "out_dir"
  ],
  [
    "cache_dir"
  ],
  [
    "out_dir"
  ],
  [
    "db"
  ],
  [
    "llm",
    "cache_dir"
  ],
  [
    "export",
    "out_dir"
  ],
  [
    "source_overrides",
    "*",
    "db"
  ],
  [
    "source_overrides",
    "*",
    "llm",
    "cache_dir"
  ],
  [
    "source_overrides",
    "*",
    "export",
    "out_dir"
  ],
  [
    "db"
  ],
  [
    "llm",
    "cache_dir"
  ],
  [
    "export",
    "out_dir"
  ],
  [
    "db"
  ],
  [
    "llm",
    "cache_dir"
  ],
  [
    "export",
    "out_dir"
  ]
];

export const RUNTIME_PATH_PATTERNS: string[][] = [
  [
    "baseDir"
  ],
  [
    "db"
  ],
  [
    "llm",
    "cacheDir"
  ],
  [
    "export",
    "outDir"
  ],
  [
    "sourceOverrides",
    "*",
    "db"
  ],
  [
    "sourceOverrides",
    "*",
    "llm",
    "cacheDir"
  ],
  [
    "sourceOverrides",
    "*",
    "export",
    "outDir"
  ],
  [
    "sources",
    "*",
    "db"
  ],
  [
    "sources",
    "*",
    "llm",
    "cacheDir"
  ],
  [
    "sources",
    "*",
    "export",
    "outDir"
  ],
  [
    "cacheDir"
  ],
  [
    "outDir"
  ],
  [
    "db"
  ],
  [
    "llm",
    "cacheDir"
  ],
  [
    "export",
    "outDir"
  ],
  [
    "sourceOverrides",
    "*",
    "db"
  ],
  [
    "sourceOverrides",
    "*",
    "llm",
    "cacheDir"
  ],
  [
    "sourceOverrides",
    "*",
    "export",
    "outDir"
  ],
  [
    "db"
  ],
  [
    "llm",
    "cacheDir"
  ],
  [
    "export",
    "outDir"
  ],
  [
    "db"
  ],
  [
    "llm",
    "cacheDir"
  ],
  [
    "export",
    "outDir"
  ]
];

export const SECRET_LEAF_NAMES: string[] = [
  "api_key"
];

export const COERCION_MAP: Record<string, 'integer' | 'number' | 'boolean'> = {
  "config_version": "integer",
  "env.override_existing": "boolean",
  "env.dotenv_required": "boolean",
  "profiles.*.llm.timeout_ms": "integer",
  "profiles.*.llm.embedding_batch_size": "integer",
  "profiles.*.llm.embedding_output_dimensionality": "integer",
  "profiles.*.editor.window_minutes": "integer",
  "profiles.*.editor.max_per_window": "integer",
  "profiles.*.editor.min_windows": "integer",
  "profiles.*.editor.min_words": "integer",
  "profiles.*.editor.min_chars": "integer",
  "profiles.*.editor.editor_llm": "boolean",
  "profiles.*.extraction.max_claims": "integer",
  "profiles.*.extraction.chunk_minutes": "integer",
  "profiles.*.extraction.max_chunks": "integer",
  "profiles.*.source_overrides.*.llm.timeout_ms": "integer",
  "profiles.*.source_overrides.*.llm.embedding_batch_size": "integer",
  "profiles.*.source_overrides.*.llm.embedding_output_dimensionality": "integer",
  "profiles.*.source_overrides.*.editor.window_minutes": "integer",
  "profiles.*.source_overrides.*.editor.max_per_window": "integer",
  "profiles.*.source_overrides.*.editor.min_windows": "integer",
  "profiles.*.source_overrides.*.editor.min_words": "integer",
  "profiles.*.source_overrides.*.editor.min_chars": "integer",
  "profiles.*.source_overrides.*.editor.editor_llm": "boolean",
  "profiles.*.source_overrides.*.extraction.max_claims": "integer",
  "profiles.*.source_overrides.*.extraction.chunk_minutes": "integer",
  "profiles.*.source_overrides.*.extraction.max_chunks": "integer",
  "sources.*.llm.timeout_ms": "integer",
  "sources.*.llm.embedding_batch_size": "integer",
  "sources.*.llm.embedding_output_dimensionality": "integer",
  "sources.*.editor.window_minutes": "integer",
  "sources.*.editor.max_per_window": "integer",
  "sources.*.editor.min_windows": "integer",
  "sources.*.editor.min_words": "integer",
  "sources.*.editor.min_chars": "integer",
  "sources.*.editor.editor_llm": "boolean",
  "sources.*.extraction.max_claims": "integer",
  "sources.*.extraction.chunk_minutes": "integer",
  "sources.*.extraction.max_chunks": "integer",
  "timeout_ms": "integer",
  "embedding_batch_size": "integer",
  "embedding_output_dimensionality": "integer",
  "window_minutes": "integer",
  "max_per_window": "integer",
  "min_windows": "integer",
  "min_words": "integer",
  "min_chars": "integer",
  "editor_llm": "boolean",
  "max_claims": "integer",
  "chunk_minutes": "integer",
  "max_chunks": "integer",
  "llm.timeout_ms": "integer",
  "llm.embedding_batch_size": "integer",
  "llm.embedding_output_dimensionality": "integer",
  "editor.window_minutes": "integer",
  "editor.max_per_window": "integer",
  "editor.min_windows": "integer",
  "editor.min_words": "integer",
  "editor.min_chars": "integer",
  "editor.editor_llm": "boolean",
  "extraction.max_claims": "integer",
  "extraction.chunk_minutes": "integer",
  "extraction.max_chunks": "integer",
  "source_overrides.*.llm.timeout_ms": "integer",
  "source_overrides.*.llm.embedding_batch_size": "integer",
  "source_overrides.*.llm.embedding_output_dimensionality": "integer",
  "source_overrides.*.editor.window_minutes": "integer",
  "source_overrides.*.editor.max_per_window": "integer",
  "source_overrides.*.editor.min_windows": "integer",
  "source_overrides.*.editor.min_words": "integer",
  "source_overrides.*.editor.min_chars": "integer",
  "source_overrides.*.editor.editor_llm": "boolean",
  "source_overrides.*.extraction.max_claims": "integer",
  "source_overrides.*.extraction.chunk_minutes": "integer",
  "source_overrides.*.extraction.max_chunks": "integer"
};

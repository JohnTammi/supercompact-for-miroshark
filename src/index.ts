/**
 * supercompact-ai
 *
 * A zero-dependency TypeScript/JavaScript token mincer.
 * Strips 40–60% of raw scraped text / HTML / Markdown before sending
 * it to an LLM, dramatically reducing API costs and Ollama inference time.
 *
 * Designed for MiroShark, RAG pipelines, and any heavy multi-agent workflow.
 *
 * @author   John Tammi / WerkkoWelhot
 * @license  MIT
 */

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface CompactionStats {
  /** Character count of the raw input */
  originalLength: number;
  /** Character count after all filters have run */
  compactedLength: number;
  /** Percentage of characters removed, 0–100 */
  savedPercent: number;
  /** Absolute number of characters removed */
  savedChars: number;
}

export interface CompactionResult {
  /** The cleaned, token-efficient text ready for LLM ingestion */
  text: string;
  /** Statistics about how much was compressed */
  stats: CompactionStats;
}

export interface SupercompactOptions {
  /**
   * Hard-truncate the output at this many characters.
   * Useful to guarantee you never exceed a model's context window.
   * Default: no limit.
   */
  maxLength?: number;
  /**
   * Minimum length a word must be to be considered a gibberish hash.
   * Increase this if your documents legitimately contain long camelCase strings.
   * Default: 40
   */
  gibberishThreshold?: number;
  /**
   * Maximum number of times an identical line may appear before
   * duplicates are dropped.
   * Default: 2
   */
  maxDuplicateLines?: number;
}

// ─── Main API ────────────────────────────────────────────────────────────────

/**
 * Compress raw text through 9 sequential filters.
 *
 * @param rawText  The raw HTML, Markdown, or plain-text string to compact.
 * @param options  Optional tuning parameters.
 * @returns        A `CompactionResult` containing the cleaned text and stats.
 *
 * @example
 * ```ts
 * import { supercompact } from 'supercompact-ai';
 *
 * const { text, stats } = supercompact(html);
 * console.log(`Saved ${stats.savedPercent}% tokens`);
 * ```
 */
export function supercompact(
  rawText: string,
  options: SupercompactOptions = {}
): CompactionResult {
  if (typeof rawText !== 'string') {
    throw new TypeError(`supercompact: expected a string, got ${typeof rawText}`);
  }

  const {
    maxLength,
    gibberishThreshold = 40,
    maxDuplicateLines = 2,
  } = options;

  const originalLength = rawText.length;

  // Guard: empty input short-circuits immediately
  if (originalLength === 0) {
    return { text: '', stats: { originalLength: 0, compactedLength: 0, savedPercent: 0, savedChars: 0 } };
  }

  let text = rawText;

  // Filter order matters — apply coarse removals first, whitespace last
  text = removeBase64(text);                          // 1. Strip massive data URIs
  text = stripScriptAndStyleTags(text);               // 2. Remove <script> / <style> blocks
  text = stripCssSelectors(text);                     // 3. Drop inline CSS selector garbage
  text = collapseBlankLines(text);                    // 4. Collapse 3+ blank lines → 1
  text = removeNavigationBoilerplate(text);           // 5. Burn nav/footer/cookie banners
  text = deduplicateSimilarLines(text, maxDuplicateLines); // 6. Deduplicate repeated lines
  text = cleanHtmlArtifacts(text);                    // 7. Decode entities, strip residual tags
  text = removeRedundantUrls(text);                   // 8. Collapse duplicate bare URLs
  text = removeGibberishTokens(text, gibberishThreshold); // 9. Zap hashes / UUIDs / minified IDs
  text = normalizeWhitespace(text);                   // 10. Final whitespace pass

  text = text.trim();

  // Hard truncation (applied after trim so stats reflect actual output)
  if (maxLength && text.length > maxLength) {
    text = text.slice(0, maxLength) + '…';
  }

  const compactedLength = text.length;
  const savedChars = originalLength - compactedLength;
  const savedPercent =
    originalLength > 0 ? Math.round((savedChars / originalLength) * 100) : 0;

  return {
    text,
    stats: {
      originalLength,
      compactedLength,
      savedPercent,
      savedChars,
    },
  };
}

/**
 * Convenience wrapper for MiroShark document ingestion.
 *
 * Enforces a sensible 100k-character output cap that is safe for
 * most 128k-context models (Qwen, GPT-4o, Gemini Flash, Claude).
 * Useful to drop in directly before the Neo4j knowledge-graph build step.
 *
 * @example
 * ```ts
 * import { compactForMiroShark } from 'supercompact-ai';
 *
 * const clean = compactForMiroShark(rawPressRelease);
 * // Pass `clean` to MiroShark's document upload endpoint
 * ```
 */
export function compactForMiroShark(rawText: string): CompactionResult {
  return supercompact(rawText, {
    maxLength: 100_000,  // ~75k tokens — fits any 128k-context model
    gibberishThreshold: 36,
    maxDuplicateLines: 1, // be more aggressive on repeat lines
  });
}

// ─── Internal Filters ────────────────────────────────────────────────────────

/** 1. Remove base64-encoded data URIs (images, PDFs, fonts, etc.) */
function removeBase64(text: string): string {
  return text
    .replace(/data:[a-z]+\/[a-z+\-.]+;base64,[A-Za-z0-9+/=]{50,}/gi, '[base64-removed]')
    .replace(/!\[.*?\]\(data:[^)]+\)/gi, '[image-removed]');
}

/**
 * 2. Remove full <script> … </script> and <style> … </style> blocks.
 * These are almost never useful in LLM context and can be enormous.
 */
function stripScriptAndStyleTags(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
}

/**
 * 3. Strip CSS selector junk that leaks in from raw HTML (class-heavy divs,
 * minified class strings like "a b c d e f...").
 * Only fires when there are 6+ single-letter tokens on one line — a clear
 * indicator of minified/utility-class output, not human text.
 */
function stripCssSelectors(text: string): string {
  return text
    .split('\n')
    .filter(line => {
      const singleLetterRun = (line.match(/\b[a-z]\b/g) ?? []).length;
      return singleLetterRun < 6; // keep non-minified lines
    })
    .join('\n');
}

/** 4. Collapse 3+ consecutive blank lines into a single blank line */
function collapseBlankLines(text: string): string {
  return text.replace(/(\r?\n\s*){3,}/g, '\n\n');
}

/** 5. Burn common web boilerplate that carries zero semantic value for LLMs */
function removeNavigationBoilerplate(text: string): string {
  const patterns: RegExp[] = [
    // Skip-to-content / accessibility links
    /^\s*(skip\s*to|hyppää|siirry)\s*(content|main|navigation|sisältöön).*/gim,
    // Cookie consent banners
    /^\s*(we use cookies|this site uses cookies|cookie policy|accept(ing)? cookies|tietosuojakäytäntö).*/gim,
    // Copyright footers
    /^\s*(all rights reserved|©\s*\d{4}|copyright\s*\d{4}).*/gim,
    // Social media standalone labels
    /^\s*(follow us on|like us on|facebook|twitter\/x|instagram|linkedin|youtube|tiktok)\s*$/gim,
    // "Powered by / Made with / Built with" attributions
    /^\s*(powered by|made with|built with)\s*.{0,60}$/gim,
    // Sitemap / breadcrumb headings
    /^\s*(sitemap|xml sitemap|breadcrumb):?.*/gim,
    // "Loading…" spinners
    /^\s*(loading|please wait|ladata).{0,20}$/gim,
  ];

  let result = text;
  for (const pattern of patterns) {
    result = result.replace(pattern, '');
  }
  return result;
}

/**
 * 6. Drop duplicate lines that appear more than `maxAllowed` times.
 *    Lines shorter than 8 characters (empty, bullets, etc.) are immune.
 *    Uses a `Set` for O(1) lookups — avoids the O(n²) bug of `Array.includes`.
 */
function deduplicateSimilarLines(text: string, maxAllowed: number): string {
  const lines = text.split('\n');
  const seenCounts = new Map<string, number>();
  const result: string[] = [];

  for (const line of lines) {
    const key = line.trim().toLowerCase();

    if (key.length < 8) {
      result.push(line); // always keep short / structural lines
      continue;
    }

    const count = seenCounts.get(key) ?? 0;
    if (count < maxAllowed) {
      result.push(line);
      seenCounts.set(key, count + 1);
    }
    // else: seen too many times — silently drop
  }

  return result.join('\n');
}

/**
 * 7. Decode HTML entities and strip residual HTML tags.
 *    Also unwraps Markdown hyperlinks → keeps the anchor text, drops the URL
 *    (URL information is low-value for most LLM tasks).
 */
function cleanHtmlArtifacts(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    // Strip any leftover short HTML tags (up to 150 chars so we don't eat prose)
    .replace(/<[^>]{1,150}>/g, ' ')
    // Unwrap [label](url) → label
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1');
}

/**
 * 8. Remove standalone duplicate URL lines.
 *    A "standalone URL" is a line containing only a bare https:// address.
 *    Uses a `Set` for O(1) deduplication.
 */
function removeRedundantUrls(text: string): string {
  const lines = text.split('\n');
  const seenUrls = new Set<string>();
  const result: string[] = [];

  for (const line of lines) {
    const stripped = line.trim();
    if (/^https?:\/\/\S+$/.test(stripped)) {
      if (!seenUrls.has(stripped)) {
        seenUrls.add(stripped);
        result.push(line);
      }
      // duplicate URL line — skip
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}

/**
 * 9. Replace obviously machine-generated tokens (UUIDs, webpack hashes,
 *    minified CSS class strings, base58 keys) with `[hash]`.
 *    Only targets word-boundary-delimited tokens so normal prose is safe.
 */
function removeGibberishTokens(text: string, threshold: number): string {
  const pattern = new RegExp(`\\b[A-Za-z0-9_\\-]{${threshold},}\\b`, 'g');
  return text.replace(pattern, '[hash]');
}

/** 10. Condense consecutive inline spaces to a single space, trim line ends */
function normalizeWhitespace(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/\s{2,}/g, ' ').trimEnd())
    .join('\n');
}

/**
 * supercompact-ai
 *
 * A zero-dependency TypeScript/JavaScript token mincer.
 * Strips 40–60% of raw scraped text / HTML / Markdown before sending
 * it to an LLM, dramatically reducing API costs and inference time.
 *
 * Works with: Claude Code, MiroShark, AutoGen, CrewAI, LangChain,
 *             OpenAI Swarm, Ollama, and any token-limited LLM pipeline.
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
 * Compress raw text through 10 sequential filters.
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

  if (originalLength === 0) {
    return { text: '', stats: { originalLength: 0, compactedLength: 0, savedPercent: 0, savedChars: 0 } };
  }

  let text = rawText;

  text = removeBase64(text);
  text = stripScriptAndStyleTags(text);
  text = stripCssSelectors(text);
  text = collapseBlankLines(text);
  text = removeNavigationBoilerplate(text);
  text = deduplicateSimilarLines(text, maxDuplicateLines);
  text = cleanHtmlArtifacts(text);
  text = removeRedundantUrls(text);
  text = removeGibberishTokens(text, gibberishThreshold);
  text = normalizeWhitespace(text);

  text = text.trim();

  if (maxLength && text.length > maxLength) {
    text = text.slice(0, maxLength) + '…';
  }

  const compactedLength = text.length;
  const savedChars = originalLength - compactedLength;
  const savedPercent =
    originalLength > 0 ? Math.round((savedChars / originalLength) * 100) : 0;

  return {
    text,
    stats: { originalLength, compactedLength, savedPercent, savedChars },
  };
}

// ─── Framework-Specific Convenience Functions ─────────────────────────────────

/**
 * Tuned for **MiroShark** — enforces a 100k char cap suitable for 128k-context
 * models (Qwen, Gemini Flash, GPT-4o). Drop in before the Neo4j graph-build step.
 *
 * @see https://github.com/aaronjmars/MiroShark
 */
export function compactForMiroShark(rawText: string): CompactionResult {
  return supercompact(rawText, {
    maxLength: 100_000,
    gibberishThreshold: 36,
    maxDuplicateLines: 1,
  });
}

/**
 * Tuned for **Claude Code / Claude API** — respects the 200k token context window.
 * Use this when piping large codebases, web pages, or issue trackers into Claude.
 * The generous maxLength (~150k chars ≈ 110k tokens) leaves room for tool outputs.
 *
 * @example
 * ```ts
 * const { text } = compactForClaude(rawWebPage);
 * const response = await anthropic.messages.create({
 *   model: 'claude-opus-4-5',
 *   messages: [{ role: 'user', content: text }],
 * });
 * ```
 */
export function compactForClaude(rawText: string): CompactionResult {
  return supercompact(rawText, {
    maxLength: 150_000, // ~110k tokens — leaves room for Claude's long sys-prompt + tools
    gibberishThreshold: 40,
    maxDuplicateLines: 2,
  });
}

/**
 * Tuned for **OpenAI / GPT-4o / GPT-5** pipelines (including multi-agent Swarm).
 * Targets ~100k chars (~75k tokens), safely within GPT-4o's 128k context.
 * Also works great for AutoGen and any OpenAI-compatible API.
 *
 * @example
 * ```ts
 * const { text } = compactForOpenAI(rawText);
 * const res = await openai.chat.completions.create({
 *   model: 'gpt-4o',
 *   messages: [{ role: 'user', content: text }],
 * });
 * ```
 */
export function compactForOpenAI(rawText: string): CompactionResult {
  return supercompact(rawText, {
    maxLength: 100_000,
    gibberishThreshold: 40,
    maxDuplicateLines: 2,
  });
}

/**
 * Tuned for **local Ollama** inference with smaller context models (8B–27B).
 * Default Ollama context is 4096 tokens. This preset fits inside 32k with room
 * to spare for system prompts and agent instructions.
 * Works great with LangChain, LlamaIndex, and CrewAI pointed at Ollama.
 *
 * @example
 * ```ts
 * const { text, stats } = compactForOllama(rawText);
 * console.log(`Reduced by ${stats.savedPercent}% — safe for local inference`);
 * ```
 */
export function compactForOllama(rawText: string): CompactionResult {
  return supercompact(rawText, {
    maxLength: 40_000,  // ~30k tokens — safe for 32k context Ollama models
    gibberishThreshold: 32,  // more aggressive — local models suffer more from noise
    maxDuplicateLines: 1,
  });
}

/**
 * Tuned for **CrewAI / LangChain / LlamaIndex** agentic pipelines.
 * These frameworks often pass documents between many sequential agents, each
 * consuming tokens. A conservative 80k cap keeps total cost predictable.
 *
 * @example
 * ```ts
 * // In a LangChain Document loader
 * const { text } = compactForAgentPipeline(doc.pageContent);
 * ```
 */
export function compactForAgentPipeline(rawText: string): CompactionResult {
  return supercompact(rawText, {
    maxLength: 80_000,
    gibberishThreshold: 36,
    maxDuplicateLines: 1,
  });
}

// ─── Internal Filters ────────────────────────────────────────────────────────

function removeBase64(text: string): string {
  return text
    .replace(/data:[a-z]+\/[a-z+\-.]+;base64,[A-Za-z0-9+/=]{50,}/gi, '[base64-removed]')
    .replace(/!\[.*?\]\(data:[^)]+\)/gi, '[image-removed]');
}

function stripScriptAndStyleTags(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
}

function stripCssSelectors(text: string): string {
  return text
    .split('\n')
    .filter(line => {
      const singleLetterRun = (line.match(/\b[a-z]\b/g) ?? []).length;
      return singleLetterRun < 6;
    })
    .join('\n');
}

function collapseBlankLines(text: string): string {
  return text.replace(/(\r?\n\s*){3,}/g, '\n\n');
}

function removeNavigationBoilerplate(text: string): string {
  const patterns: RegExp[] = [
    /^\s*(skip\s*to|hyppää|siirry)\s*(content|main|navigation|sisältöön).*/gim,
    /^\s*(we use cookies|this site uses cookies|cookie policy|accept(ing)? cookies).*/gim,
    /^\s*(all rights reserved|©\s*\d{4}|copyright\s*\d{4}).*/gim,
    /^\s*(follow us on|like us on|facebook|twitter\/x|instagram|linkedin|youtube|tiktok)\s*$/gim,
    /^\s*(powered by|made with|built with)\s*.{0,60}$/gim,
    /^\s*(sitemap|xml sitemap|breadcrumb):?.*/gim,
    /^\s*(loading|please wait)\s*.{0,20}$/gim,
  ];
  let result = text;
  for (const pattern of patterns) result = result.replace(pattern, '');
  return result;
}

function deduplicateSimilarLines(text: string, maxAllowed: number): string {
  const lines = text.split('\n');
  const seenCounts = new Map<string, number>();
  const result: string[] = [];
  for (const line of lines) {
    const key = line.trim().toLowerCase();
    if (key.length < 8) { result.push(line); continue; }
    const count = seenCounts.get(key) ?? 0;
    if (count < maxAllowed) { result.push(line); seenCounts.set(key, count + 1); }
  }
  return result.join('\n');
}

function cleanHtmlArtifacts(text: string): string {
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ').replace(/&[a-z]+;/gi, ' ')
    .replace(/<[^>]{1,150}>/g, ' ')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1');
}

function removeRedundantUrls(text: string): string {
  const lines = text.split('\n');
  const seenUrls = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const stripped = line.trim();
    if (/^https?:\/\/\S+$/.test(stripped)) {
      if (!seenUrls.has(stripped)) { seenUrls.add(stripped); result.push(line); }
    } else {
      result.push(line);
    }
  }
  return result.join('\n');
}

function removeGibberishTokens(text: string, threshold: number): string {
  return text.replace(new RegExp(`\\b[A-Za-z0-9_\\-]{${threshold},}\\b`, 'g'), '[hash]');
}

function normalizeWhitespace(text: string): string {
  return text.split('\n').map(line => line.replace(/\s{2,}/g, ' ').trimEnd()).join('\n');
}

# Supercompact AI

**A zero-dependency TypeScript/JavaScript token mincer that cuts 40–60% of your LLM input before it ever hits the API.**

Works with any token-limited AI pipeline:

| Framework | Import |
|---|---|
| **Claude Code / Anthropic** | `compactForClaude(text)` |
| **OpenAI / GPT-4o / Swarm** | `compactForOpenAI(text)` |
| **Local Ollama (8B–27B)** | `compactForOllama(text)` |
| **MiroShark** | `compactForMiroShark(text)` |
| **LangChain / CrewAI / LlamaIndex** | `compactForAgentPipeline(text)` |
| **Any other LLM** | `supercompact(text, { maxLength: N })` |

---

## Why does this matter?

Raw HTML, scraped web pages, PDF dumps, and issue tracker exports are full of garbage that burns your tokens:

- 🗑️ `<script>` and `<style>` blocks
- 🗑️ Base64 image blobs (`data:image/png;base64,...`)
- 🗑️ Cookie banners, nav boilerplate, footer links
- 🗑️ Webpack/CSS hash strings (`a8f3c2d1e9b7...`)
- 🗑️ Duplicate headers/footers repeated 10× per page
- 🗑️ Bare URL lists with no semantic value

None of that helps your agents. All of it burns tokens.

Supercompact strips it in milliseconds, **without any external dependencies**.

---

## Installation

```bash
npm install supercompact-ai
```

---

## Usage

### Generic (any model)
```typescript
import { supercompact } from 'supercompact-ai';

const { text, stats } = supercompact(rawHtml);
console.log(`Saved ${stats.savedPercent}%  (${stats.savedChars} chars)`);
// e.g. "Saved 54%  (8200 chars)"
```

### Claude Code / Anthropic
```typescript
import { compactForClaude } from 'supercompact-ai';

const { text } = compactForClaude(rawWebPage);
const response = await anthropic.messages.create({
  model: 'claude-opus-4-5',
  messages: [{ role: 'user', content: text }],
});
```

### OpenAI / GPT-4o / AutoGen / Swarm
```typescript
import { compactForOpenAI } from 'supercompact-ai';

const { text } = compactForOpenAI(rawText);
const res = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: text }],
});
```

### Local Ollama
```typescript
import { compactForOllama } from 'supercompact-ai';

// Fits safely in a 32k context window — essential for local 8B–27B models
const { text } = compactForOllama(rawText);
```

### MiroShark (multi-agent simulation)
```typescript
import { compactForMiroShark } from 'supercompact-ai';

// Drop in before the Neo4j knowledge-graph build step
const { text } = compactForMiroShark(rawPressRelease);
```

### LangChain / CrewAI / LlamaIndex
```typescript
import { compactForAgentPipeline } from 'supercompact-ai';

// Documents pass through many agents — keep cost predictable
const { text } = compactForAgentPipeline(doc.pageContent);
```

---

## The 10 Filters (in order)

| # | Filter | What it removes |
|---|---|---|
| 1 | Base64 stripper | `data:image` blobs, PDF data URIs |
| 2 | Script/Style remover | `<script>` and `<style>` blocks |
| 3 | CSS selector killer | Minified utility-class token lines |
| 4 | Blank line collapser | 3+ blank lines → 1 |
| 5 | Boilerplate burner | Cookie banners, copyright, nav links |
| 6 | Deduplicator | Repeated header/footer lines |
| 7 | HTML entity cleaner | `&nbsp;`, `&amp;`, residual tags |
| 8 | URL reducer | Duplicate bare URL-only lines |
| 9 | Gibberish hunter | Hashes, UUIDs, webpack chunk IDs |
| 10 | Whitespace normalizer | Excessive inline spaces |

---

## Advanced Options

```typescript
import { supercompact } from 'supercompact-ai';

const result = supercompact(text, {
  maxLength: 50_000,       // hard cap on output chars
  gibberishThreshold: 32,  // flag tokens shorter than this as gibberish (default: 40)
  maxDuplicateLines: 1,    // drop lines after they appear this many times (default: 2)
});
```

---

## Context window presets by wrapper

| Function | maxLength | Approx tokens | Target models |
|---|---|---|---|
| `compactForClaude` | 150,000 | ~110k | Claude 3/4 (200k ctx) |
| `compactForOpenAI` | 100,000 | ~75k | GPT-4o, GPT-5 (128k ctx) |
| `compactForMiroShark` | 100,000 | ~75k | Qwen, Gemini Flash (128k ctx) |
| `compactForAgentPipeline` | 80,000 | ~60k | LangChain, CrewAI agents |
| `compactForOllama` | 40,000 | ~30k | Local 8B–27B (32k ctx) |

---

## License

MIT — free to use in commercial products, open-source projects, and AI startups.

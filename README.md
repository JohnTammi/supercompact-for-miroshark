# Supercompact AI

A zero-dependency, ultra-lightweight TypeScript utility that minces and compresses raw HTML/Markdown data by **40% to 60%** before sending it to LLMs. 

Built specifically for high-volume, multi-agent frameworks like **[MiroShark](https://github.com/aaronjmars/MiroShark)** or RAG pipelines where feeding massive scraped documents into Ollama / OpenAI Context Windows quickly hits token limits or skyrockets API costs.

## Why use this with MiroShark?
MiroShark generates hundreds of AI personas that simulate public reactions to uploaded documents (press releases, financial reports, etc.). If you feed a raw 50-page PDF or a heavily nested HTML scrape into the Neo4j Knowledge Graph, you are wasting tens of thousands of tokens on boilerplate, whitespaces, and base64 strings.

**Supercompact AI** cleans the data *before* embedding it or sending it to the simulation engine, dramatically speeding up local Ollama inference times and saving money on cloud APIs.

## Installation

\`\`\`bash
npm install supercompact-ai
\`\`\`

## Usage

\`\`\`typescript
import { supercompact } from 'supercompact-ai';

const rawScrapedData = "<html>... massive string ...</html>";

const result = supercompact(rawScrapedData);

console.log(result.text); // The condensed, AI-ready text
console.log(result.stats);
/*
{
  originalLength: 15420,
  compactedLength: 6800,
  savedPercent: 56,
  savedChars: 8620
}
*/
\`\`\`

## What it actually does (The 8 Filters)
Supercompact runs text through 8 specialized Regex filters optimized for LLM readability:
1. **Base64 Stripper:** Removes massive inline `data:image` strings from HTML/Markdown.
2. **Blank Line Collapser:** Folds 3+ line breaks into simple paragraphs.
3. **Boilerplate Burner:** Automatically deletes GDPR cookie banners, "Skip to content" links, copyright notices, and generic social media labels.
4. **Deduplicator:** Smartly removes repetitive footer/header navigation rows if they occur more than twice.
5. **Entity Cleaner:** Strips leftover HTML tags and encodes raw entities (`&nbsp;`).
6. **URL Reducer:** Combines massive duplicate hyperlink lists.
7. **Gibberish Hunter:** Deletes 40+ character machine-generated hashes (like CSS modules, UUIDs, or webpack chunks).
8. **Whitespace Normalizer:** Condenses excessive inline spacing.

## License
MIT License.

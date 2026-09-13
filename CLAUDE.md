# obsidian-ai-briefing

Obsidian plugin that generates weekly AI news digests curated by an LLM.
Daily automatic collection from 14+ sources, weekly curated digest with
preview modal and configurable LLM provider.

---

## Stack

| Part | Technology |
|---|---|
| Plugin framework | Obsidian Plugin API (desktop only) |
| Language | TypeScript |
| Bundler | esbuild |
| AI curation | Multi-provider: Anthropic, OpenAI-compatible, Google Gemini, Ollama |
| HTTP | Obsidian `requestUrl` (no node-fetch) |
| Data sources | RSS/Atom, HuggingFace Papers API, HN Algolia API, ArXiv API, Reddit, GitHub |
| Persistence | Obsidian `loadData/saveData` (settings + cache in data.json) |

---

## Project Structure

```
obsidian-ai-briefing/
├── main.ts              # All plugin code (Obsidian convention: one file)
├── manifest.json        # Plugin metadata (id, name, version, minAppVersion)
├── package.json         # devDependencies only (esbuild, typescript, obsidian types)
├── esbuild.config.mjs   # Build config
├── tsconfig.json        # TypeScript config
├── styles.css           # Preview modal and settings styles
├── CLAUDE.md            # This file
└── README.md            # User documentation
```

---

## Build and Development

```bash
npm install
npm run build      # production -> main.js
npm run dev        # watch mode for development
```

### Install locally in Obsidian during development

```bash
VAULT=/path/to/vault
PLUGIN="$VAULT/.obsidian/plugins/obsidian-ai-briefing"
mkdir -p "$PLUGIN"
cp main.js manifest.json styles.css "$PLUGIN/"
```

Obsidian: Settings -> Community plugins -> disable Restricted mode -> enable the plugin.

---

## Architecture (main.ts)

```
Code organization (top -> bottom):
1.  Imports (from 'obsidian')
2.  Constants + type definitions
3.  DEFAULT_SETTINGS
4.  Utility functions (generateId, normalizeUrl, stripHtml, etc.)
5.  fetchRSS — generic RSS/Atom parser (DOMParser)
6.  API fetch functions (HuggingFace, HN, ArXiv, Reddit, GitHub)
7.  DEFAULT_SOURCES (14 built-in sources) + getActiveSources()
8.  Collection engine (collectArticles, deduplicateArticles)
9.  LLM providers (Anthropic, OpenAI-compatible, Gemini, Ollama)
10. buildCurationPrompt + parseCurationResponse
11. Note generator (generateNoteContent, saveDigestNote)
12. DigestPreviewModal (extends Modal)
13. AIWeeklySettingTab (extends PluginSettingTab)
14. AIWeeklyPlugin (extends Plugin) — default export
```

---

## LLM Providers

| Provider | API format | Covers |
|---|---|---|
| Anthropic | Own (system field, x-api-key) | Claude Haiku/Sonnet/Opus |
| OpenAI-compatible | OpenAI chat/completions | OpenAI, Groq (free), OpenRouter, Mistral (free), custom |
| Google Gemini | Own (generateContent) | Gemini 2.0 Flash (free), 2.5 Pro/Flash |
| Ollama | Own (local) | All local models |

OpenAI-compatible has presets that auto-fill endpoint and model choices.

---

## Built-in Sources (14 total)

**RSS Feeds (9):** MIT Tech Review, The Batch, Google AI Blog, OpenAI Blog,
Anthropic Research, Import AI, The Gradient, Ahead of AI, AI News

**API sources (5):** HuggingFace Papers, Hacker News (AI), ArXiv (cs.AI+cs.LG),
Reddit r/MachineLearning, GitHub Trending AI/ML

The user can add their own RSS feeds via the settings UI.

---

## Important Conventions

- **Always use `requestUrl` from obsidian** — not `fetch` or `axios`
- **No runtime npm dependencies** — everything in the Obsidian API or implemented manually
- **One file** — keep everything in `main.ts`
- **JSON from LLM** — strip markdown backticks defensively before JSON.parse
- **Error handling** — `new Notice(...)` for user-facing errors, `console.warn` per source
- **Promise.allSettled** — per-source error isolation in the collection engine
- **CSS variables** — use Obsidian's theme variables for compatibility
- **DOMParser** — available in Electron's renderer for XML parsing

---

## Settings (AIWeeklySettings)

```typescript
interface AIWeeklySettings {
  llmProvider: LLMProviderType;       // 'anthropic' | 'openai-compatible' | 'gemini' | 'ollama'
  // Anthropic
  anthropicApiKey: string;
  anthropicModel: string;             // Default: 'claude-haiku-4-5-20251001'
  // OpenAI-compatible
  openaiCompatPreset: OpenAICompatPreset;
  openaiCompatEndpoint: string;
  openaiCompatApiKey: string;
  openaiCompatModel: string;
  // Google Gemini
  geminiApiKey: string;
  geminiModel: string;
  // Ollama
  ollamaEndpoint: string;
  ollamaModel: string;
  // Sources
  sourceOverrides: Record<string, boolean>;
  customSources: CustomSourceDef[];
  // Schedule
  autoCollectEnabled: boolean;
  collectHour: number;                // 0-23
  autoDigestEnabled: boolean;
  digestDay: number;                  // 0=Sunday, 1=Monday, ...
  digestHour: number;
  // Output
  outputFolder: string;               // Default: 'AI-Weekly'
  language: 'en' | 'no';
  maxArticlesPerDigest: number;       // Default: 20
  // Internal tracking
  lastCollectionDate: string;
  lastDigestWeek: string;
}
```

---

## Data Flow

1. **Daily collection** (auto at 06:00 or manual)
   - Fetches from all enabled sources in parallel (Promise.allSettled)
   - Deduplicates via normalized URL
   - Stores in cache (data.json), pruned after 14 days

2. **Weekly digest** (auto Monday at 07:00 or manual)
   - Filters cache to the last 7 days
   - Sends to the chosen LLM with a curation prompt
   - Shows preview modal with categorized articles
   - User confirms -> generates markdown note with frontmatter + tags

---

## Known Limitations

- `isDesktopOnly: true` — Obsidian mobile does not support all required APIs
- HuggingFace Papers API returns the last ~24h — daily collection solves this
- ArXiv rate-limits aggressively (1 req/3s) — only one call per collection
- Reddit requires a User-Agent header to avoid 429
- GitHub Search API: 10 req/min unauthenticated
- Auto-run requires Obsidian to be open
- Ollama requires `stream: false` for requestUrl compatibility

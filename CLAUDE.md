# obsidian-ai-briefing

Obsidian plugin som genererer ukentlige AI-nyhetsdigest kuratert av LLM.
Daglig automatisk innsamling fra 14+ kilder, ukentlig kuratert digest med
preview-modal og konfigurerbar LLM-leverandor.

---

## Stack

| Del | Teknologi |
|---|---|
| Plugin-rammeverk | Obsidian Plugin API (desktop only) |
| Sprak | TypeScript |
| Bundler | esbuild |
| AI-kurattering | Multi-provider: Anthropic, OpenAI-kompatibel, Google Gemini, Ollama |
| HTTP | Obsidian `requestUrl` (ingen node-fetch) |
| Datakilder | RSS/Atom, HuggingFace Papers API, HN Algolia API, ArXiv API, Reddit, GitHub |
| Persistens | Obsidian `loadData/saveData` (settings + cache i data.json) |

---

## Prosjektstruktur

```
obsidian-ai-briefing/
├── main.ts              # Alt plugin-kode (Obsidian-konvensjon: en fil)
├── manifest.json        # Plugin-metadata (id, name, version, minAppVersion)
├── package.json         # Kun devDependencies (esbuild, typescript, obsidian types)
├── esbuild.config.mjs   # Build-konfig
├── tsconfig.json        # TypeScript-konfig
├── styles.css           # Preview-modal og settings-stiler
├── CLAUDE.md            # Denne filen
└── README.md            # Bruker-dokumentasjon
```

---

## Bygg og utvikling

```bash
npm install
npm run build      # produksjon -> main.js
npm run dev        # watch-modus for utvikling
```

### Installer lokalt i Obsidian under utvikling

```bash
VAULT=/path/to/vault
PLUGIN="$VAULT/.obsidian/plugins/obsidian-ai-briefing"
mkdir -p "$PLUGIN"
cp main.js manifest.json styles.css "$PLUGIN/"
```

Obsidian: Innstillinger -> Community plugins -> skru av Restricted mode -> aktiver plugin.

---

## Arkitektur (main.ts)

```
Kodeorganisering (topp -> bunn):
1.  Imports (fra 'obsidian')
2.  Konstanter + type-definisjoner
3.  DEFAULT_SETTINGS
4.  Utility-funksjoner (generateId, normalizeUrl, stripHtml, etc.)
5.  fetchRSS — generisk RSS/Atom-parser (DOMParser)
6.  API fetch-funksjoner (HuggingFace, HN, ArXiv, Reddit, GitHub)
7.  DEFAULT_SOURCES (14 innebygde kilder) + getActiveSources()
8.  Collection engine (collectArticles, deduplicateArticles)
9.  LLM providers (Anthropic, OpenAI-kompatibel, Gemini, Ollama)
10. buildCurationPrompt + parseCurationResponse
11. Note-generator (generateNoteContent, saveDigestNote)
12. DigestPreviewModal (extends Modal)
13. AIWeeklySettingTab (extends PluginSettingTab)
14. AIWeeklyPlugin (extends Plugin) — default export
```

---

## LLM Providers

| Provider | API-format | Dekker |
|---|---|---|
| Anthropic | Eget (system-felt, x-api-key) | Claude Haiku/Sonnet/Opus |
| OpenAI-kompatibel | OpenAI chat/completions | OpenAI, Groq (gratis), OpenRouter, Mistral (gratis), custom |
| Google Gemini | Eget (generateContent) | Gemini 2.0 Flash (gratis), 2.5 Pro/Flash |
| Ollama | Eget (lokalt) | Alle lokale modeller |

OpenAI-kompatibel har presets som auto-fyller endpoint og modell-valg.

---

## Innebygde kilder (14 stk)

**RSS Feeds (9):** MIT Tech Review, The Batch, Google AI Blog, OpenAI Blog,
Anthropic Research, Import AI, The Gradient, Ahead of AI, AI News

**API-kilder (5):** HuggingFace Papers, Hacker News (AI), ArXiv (cs.AI+cs.LG),
Reddit r/MachineLearning, GitHub Trending AI/ML

Brukeren kan legge til egne RSS-feeds via settings UI.

---

## Viktige konvensjoner

- **Bruk alltid `requestUrl` fra obsidian** — ikke `fetch` eller `axios`
- **Ingen runtime npm-avhengigheter** — alt i Obsidian API eller manuelt implementert
- **En fil** — hold alt i `main.ts`
- **JSON fra LLM** — strip markdown-backticks defensivt for JSON.parse
- **Feilhandtering** — `new Notice(...)` for brukervendte feil, `console.warn` per kilde
- **Promise.allSettled** — per-kilde feil-isolasjon i collection engine
- **CSS-variabler** — bruk Obsidians tema-variabler for kompatibilitet
- **DOMParser** — tilgjengelig i Electrons renderer for XML-parsing

---

## Settings (AIWeeklySettings)

```typescript
interface AIWeeklySettings {
  llmProvider: LLMProviderType;       // 'anthropic' | 'openai-compatible' | 'gemini' | 'ollama'
  // Anthropic
  anthropicApiKey: string;
  anthropicModel: string;             // Default: 'claude-haiku-4-5-20251001'
  // OpenAI-kompatibel
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
  // Kilder
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
  // Intern tracking
  lastCollectionDate: string;
  lastDigestWeek: string;
}
```

---

## Dataflyt

1. **Daglig innsamling** (auto kl. 06 eller manuelt)
   - Henter fra alle aktiverte kilder parallelt (Promise.allSettled)
   - Dedupliserer via normalisert URL
   - Lagrer i cache (data.json), prunes etter 14 dager

2. **Ukentlig digest** (auto mandag kl. 07 eller manuelt)
   - Filtrerer cache til siste 7 dager
   - Sender til valgt LLM med kuratering-prompt
   - Viser preview-modal med kategoriserte artikler
   - Bruker bekrefter -> genererer markdown-notat med frontmatter + tags

---

## Kjente begrensninger

- `isDesktopOnly: true` — Obsidian mobil stotter ikke alle nodige APIer
- HuggingFace Papers API returnerer siste ~24t — daglig innsamling loser dette
- ArXiv rate-limiter aggressivt (1 req/3s) — kun ett kall per innsamling
- Reddit krever User-Agent header for a unnga 429
- GitHub Search API: 10 req/min uautentisert
- Auto-run krever at Obsidian er apent
- Ollama krever `stream: false` for requestUrl-kompatibilitet

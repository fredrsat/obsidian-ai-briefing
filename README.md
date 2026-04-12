# AI Briefing for Obsidian

An Obsidian plugin that automatically collects AI news from 14+ curated sources and generates weekly briefing notes using your choice of LLM provider.

Daily article collection runs in the background. Once a week, your chosen LLM curates the most important stories into a structured Obsidian note — grouped by category, scored by relevance, with an "Article of the Week" highlight.

## Features

- **14 built-in AI news sources** — RSS feeds and APIs covering research papers, industry news, and open-source projects
- **Multi-provider LLM curation** — Anthropic, OpenAI-compatible (OpenAI/Groq/OpenRouter/Mistral), Google Gemini, or Ollama (local)
- **Free tier support** — works with Groq, Mistral, and Gemini free tiers out of the box
- **Preview before saving** — review and edit the curated briefing in a modal before it becomes a note
- **Automatic scheduling** — daily collection + weekly digest generation, fully configurable
- **Custom feeds** — add your own RSS feeds alongside the built-in sources
- **Category tagging** — notes are auto-tagged (LLMs, Robotics, AI Policy, etc.) for Obsidian search and Dataview

## Built-in Sources

### RSS Feeds
| Source | Description |
|---|---|
| MIT Technology Review AI | AI coverage from MIT Tech Review |
| The Batch | Andrew Ng's weekly AI newsletter |
| Google AI Blog | Research and product updates from Google |
| OpenAI Blog | Updates from OpenAI |
| Anthropic Research | Research publications from Anthropic |
| Import AI | Jack Clark's AI newsletter |
| The Gradient | Long-form AI/ML essays |
| Ahead of AI | Sebastian Raschka's newsletter |
| AI News | Industry AI news aggregator |

### API Sources
| Source | Description |
|---|---|
| HuggingFace Daily Papers | Top-voted papers on HuggingFace |
| Hacker News (AI) | AI-filtered stories with 10+ points |
| ArXiv (cs.AI + cs.LG) | Latest AI and machine learning papers |
| Reddit r/MachineLearning | Top posts from the ML subreddit |
| GitHub Trending (AI/ML) | Trending AI/ML repositories |

## LLM Providers

| Provider | Endpoint | Free Tier |
|---|---|---|
| **Anthropic** | Claude Haiku / Sonnet / Opus | No |
| **OpenAI** | GPT-4o, GPT-4o-mini | No |
| **Groq** | Llama 3.3 70B, Mixtral | Yes |
| **OpenRouter** | 100+ models | Some |
| **Mistral** | Mistral Small, Codestral | Yes |
| **Google Gemini** | Gemini 2.0 Flash, 2.5 Pro | Yes (15 RPM) |
| **Ollama** | Any local model | Free (local) |

The OpenAI-compatible provider works with any service that implements the OpenAI chat completions API. Preset endpoints are provided for popular services, or you can set a custom endpoint URL.

## Installation

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/fredrsat/obsidian-ai-briefing/releases)
2. Create a folder: `<your-vault>/.obsidian/plugins/ai-briefing/`
3. Copy the three files into that folder
4. In Obsidian: Settings > Community plugins > disable Restricted mode > enable "AI Briefing"

### Build from Source

```bash
git clone https://github.com/fredrsat/obsidian-ai-briefing.git
cd obsidian-ai-briefing
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` to your vault's plugin folder.

## Setup

1. Open plugin settings (Settings > AI Briefing)
2. Select your **LLM provider** and enter your API key
3. Review the **News Sources** and toggle any you want to enable/disable
4. Optionally add **custom RSS feeds**
5. Configure **scheduling** (defaults: collect daily at 06:00, digest on Mondays at 07:00)
6. Set your preferred **output folder** and **language** (English or Norwegian)

## Usage

### Manual
- **Command palette:** `AI Briefing: Collect articles now` — fetches articles from all enabled sources
- **Command palette:** `AI Briefing: Generate weekly digest` — curates cached articles and opens the preview modal
- **Settings:** Use the "Collect Now" and "Generate Digest" buttons in the plugin settings

### Automatic
When enabled, the plugin checks every 30 minutes:
- **Daily collection** — if the current hour is past the configured collection hour and articles haven't been collected today
- **Weekly digest** — if it's the configured day/hour and a digest hasn't been generated this week

Auto-run requires Obsidian to be open at the scheduled time.

## Output Format

Each briefing is a Markdown note with:

- **YAML frontmatter** — date, week number, tags, article count
- **Article of the Week** — highlighted callout block
- **Categorized sections** — articles grouped by theme (LLMs, Computer Vision, Robotics, AI Policy, Tools & Frameworks, Research Papers, Industry News)
- **Per-article info** — title (linked), source, relevance score, LLM-written summary
- **Reflections section** — empty section for your own notes

## Network Disclosure

This plugin makes outbound HTTPS requests to the following services:

**News sources (article collection):**
- RSS feeds: MIT Tech Review, deeplearning.ai, Google AI Blog, OpenAI Blog, Import AI, The Gradient, Ahead of AI, AI News, and a community-maintained Anthropic Research feed (via GitHub)
- APIs: HuggingFace (huggingface.co), Hacker News (hn.algolia.com), ArXiv (export.arxiv.org), Reddit (reddit.com), GitHub (api.github.com)

**LLM providers (digest curation) — only the one you configure:**
- Anthropic API (api.anthropic.com)
- OpenAI-compatible endpoints (api.openai.com, api.groq.com, openrouter.ai, api.mistral.ai, or custom)
- Google Gemini API (generativelanguage.googleapis.com)
- Ollama (localhost, no external network)

No data is sent to any service beyond what is needed for the configured features. No telemetry or analytics are collected.

## Security

- API keys are stored in Obsidian's plugin data file (`data.json`) inside the `.obsidian` folder
- Keys are entered via password fields with autocomplete disabled
- No API keys or secrets are hardcoded in the source code
- All HTTP requests use Obsidian's `requestUrl` wrapper (HTTPS)
- External content (RSS, API responses) is sanitized before display

**Recommendations:**
- Do not sync your `.obsidian/plugins/` folder to public cloud storage if it contains API keys
- Consider using free-tier providers (Groq, Gemini) if you want to avoid managing paid API keys
- Ollama requires no API key at all (runs locally)

## Development

```bash
npm run dev    # Watch mode — rebuilds on file changes
npm run build  # Production build
```

The plugin follows Obsidian's single-file convention — all source code is in `main.ts`.

## License

MIT

import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, requestUrl, TFile } from 'obsidian';

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================

type ArticleCategory =
  | 'LLMs'
  | 'Computer Vision'
  | 'Robotics'
  | 'AI Policy'
  | 'Tools & Frameworks'
  | 'Research Papers'
  | 'Industry News';

const ARTICLE_CATEGORIES: ArticleCategory[] = [
  'LLMs', 'Computer Vision', 'Robotics', 'AI Policy',
  'Tools & Frameworks', 'Research Papers', 'Industry News',
];

interface RawArticle {
  id: string;
  title: string;
  url: string;
  source: string;
  sourceName: string;
  date: string;
  summary: string;
  category?: string;
  score?: number;
  fetchedAt: string;
}

interface CuratedArticle {
  id: string;
  title: string;
  url: string;
  source: string;
  sourceName: string;
  date: string;
  summary: string;
  originalSummary: string;
  category: ArticleCategory;
  relevanceScore: number;
  isArticleOfTheWeek: boolean;
  included: boolean;
}

interface CurationResult {
  articles: CuratedArticle[];
  articleOfTheWeekId: string;
}

type LLMProviderType = 'anthropic' | 'openai-compatible' | 'gemini' | 'ollama';

interface LLMProvider {
  type: LLMProviderType;
  curate(articles: RawArticle[], language: 'en' | 'no', maxArticles: number): Promise<CurationResult>;
}

type SourceType = 'rss' | 'api';

interface SourceDefinition {
  id: string;
  name: string;
  type: SourceType;
  url: string;
  category: string;
  enabled: boolean;
}

interface CustomSourceDef {
  id: string;
  name: string;
  url: string;
  category: string;
  enabled: boolean;
}

interface SourceError {
  sourceId: string;
  sourceName: string;
  error: string;
}

type OpenAICompatPreset = 'openai' | 'groq' | 'openrouter' | 'mistral' | 'custom';

const OPENAI_COMPAT_PRESETS: Record<OpenAICompatPreset, { name: string; endpoint: string; models: string[] }> = {
  openai:     { name: 'OpenAI',          endpoint: 'https://api.openai.com/v1',       models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'] },
  groq:       { name: 'Groq (Free)',     endpoint: 'https://api.groq.com/openai/v1',  models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768', 'gemma2-9b-it'] },
  openrouter: { name: 'OpenRouter',      endpoint: 'https://openrouter.ai/api/v1',    models: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'meta-llama/llama-3.3-70b-instruct'] },
  mistral:    { name: 'Mistral (Free)',  endpoint: 'https://api.mistral.ai/v1',       models: ['mistral-small-latest', 'codestral-latest', 'open-mistral-nemo'] },
  custom:     { name: 'Custom',          endpoint: '',                                 models: [] },
};

interface AIWeeklySettings {
  llmProvider: LLMProviderType;
  anthropicApiKey: string;
  anthropicModel: string;
  openaiCompatPreset: OpenAICompatPreset;
  openaiCompatEndpoint: string;
  openaiCompatApiKey: string;
  openaiCompatModel: string;
  geminiApiKey: string;
  geminiModel: string;
  ollamaEndpoint: string;
  ollamaModel: string;
  sourceOverrides: Record<string, boolean>;
  customSources: CustomSourceDef[];
  autoCollectEnabled: boolean;
  collectHour: number;
  autoDigestEnabled: boolean;
  digestDay: number;
  digestHour: number;
  outputFolder: string;
  language: 'en' | 'no';
  maxArticlesPerDigest: number;
  lastCollectionDate: string;
  lastDigestWeek: string;
}

interface PluginCache {
  articles: RawArticle[];
}

interface PersistedData {
  settings: AIWeeklySettings;
  cache: PluginCache;
}

const DEFAULT_SETTINGS: AIWeeklySettings = {
  llmProvider: 'anthropic',
  anthropicApiKey: '',
  anthropicModel: 'claude-haiku-4-5-20251001',
  openaiCompatPreset: 'openai',
  openaiCompatEndpoint: 'https://api.openai.com/v1',
  openaiCompatApiKey: '',
  openaiCompatModel: 'gpt-4o',
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash',
  ollamaEndpoint: 'http://localhost:11434',
  ollamaModel: 'llama3',
  sourceOverrides: {},
  customSources: [],
  autoCollectEnabled: true,
  collectHour: 6,
  autoDigestEnabled: true,
  digestDay: 1,
  digestHour: 7,
  outputFolder: 'AI-Briefing',
  language: 'en',
  maxArticlesPerDigest: 20,
  lastCollectionDate: '',
  lastDigestWeek: '',
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function generateId(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    let normalized = u.protocol + '//' + u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '');
    return normalized.toLowerCase();
  } catch {
    return url.toLowerCase().replace(/\/$/, '');
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

function getISOWeekNumber(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { week, year: d.getUTCFullYear() };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isValidFeedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function currentWeekStr(): string {
  const { week, year } = getISOWeekNumber(new Date());
  return `${year}-${String(week).padStart(2, '0')}`;
}

async function withRetry<T>(fn: () => Promise<T>, retries = 1, delayMs = 2000): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return withRetry(fn, retries - 1, delayMs);
  }
}

function categoryToTag(category: ArticleCategory): string {
  return category.toLowerCase().replace(/ & /g, '-').replace(/ /g, '-');
}

// ============================================================================
// RSS / ATOM PARSER
// ============================================================================

async function fetchRSS(source: SourceDefinition): Promise<RawArticle[]> {
  const response = await requestUrl({ url: source.url, method: 'GET' });
  const xml = response.text;
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');

  const articles: RawArticle[] = [];
  const sevenDaysAgo = daysAgo(7);

  // Try RSS 2.0 first
  const items = doc.querySelectorAll('item');
  if (items.length > 0) {
    items.forEach(item => {
      const title = item.querySelector('title')?.textContent?.trim() || '';
      const link = item.querySelector('link')?.textContent?.trim() || '';
      const description = item.querySelector('description')?.textContent || '';
      const contentEncoded = item.querySelector('content\\:encoded, encoded')?.textContent || '';
      const pubDate = item.querySelector('pubDate')?.textContent || '';
      const date = pubDate ? new Date(pubDate) : new Date();

      if (date < sevenDaysAgo || !title || !link) return;

      articles.push({
        id: generateId(link),
        title: stripHtml(title),
        url: link,
        source: source.id,
        sourceName: source.name,
        date: date.toISOString(),
        summary: truncate(stripHtml(contentEncoded || description), 500),
        fetchedAt: new Date().toISOString(),
      });
    });
    return articles;
  }

  // Try Atom
  const entries = doc.querySelectorAll('entry');
  entries.forEach(entry => {
    const title = entry.querySelector('title')?.textContent?.trim() || '';
    const linkEl = entry.querySelector('link[href]');
    const link = linkEl?.getAttribute('href') || '';
    const summary = entry.querySelector('summary')?.textContent || '';
    const content = entry.querySelector('content')?.textContent || '';
    const published = entry.querySelector('published')?.textContent
      || entry.querySelector('updated')?.textContent || '';
    const date = published ? new Date(published) : new Date();

    if (date < sevenDaysAgo || !title || !link) return;

    articles.push({
      id: generateId(link),
      title: stripHtml(title),
      url: link,
      source: source.id,
      sourceName: source.name,
      date: date.toISOString(),
      summary: truncate(stripHtml(content || summary), 500),
      fetchedAt: new Date().toISOString(),
    });
  });

  return articles;
}

// ============================================================================
// API FETCH FUNCTIONS
// ============================================================================

async function fetchHuggingFacePapers(source: SourceDefinition): Promise<RawArticle[]> {
  const response = await requestUrl({
    url: 'https://huggingface.co/api/daily_papers',
    method: 'GET',
  });
  const papers: Array<{
    paper: { id: string; title: string; summary: string; publishedAt: string };
    upvotes: number;
  }> = response.json;

  return papers.map(p => ({
    id: generateId(p.paper.id),
    title: p.paper.title.trim(),
    url: `https://huggingface.co/papers/${p.paper.id}`,
    source: source.id,
    sourceName: source.name,
    date: p.paper.publishedAt || new Date().toISOString(),
    summary: truncate(p.paper.summary.replace(/\n/g, ' ').trim(), 500),
    score: p.upvotes,
    fetchedAt: new Date().toISOString(),
  }));
}

async function fetchHackerNews(source: SourceDefinition): Promise<RawArticle[]> {
  const oneDayAgo = Math.floor(daysAgo(1).getTime() / 1000);
  const query = encodeURIComponent('AI OR "artificial intelligence" OR "machine learning" OR LLM OR "large language model" OR GPT OR Claude OR Gemini');
  const url = `https://hn.algolia.com/api/v1/search?query=${query}&tags=story&numericFilters=created_at_i>${oneDayAgo}&hitsPerPage=30`;

  const response = await requestUrl({ url, method: 'GET' });
  const data: { hits: Array<{ objectID: string; title: string; url: string; points: number; created_at: string }> } = response.json;

  return data.hits
    .filter(hit => hit.points >= 10)
    .map(hit => ({
      id: generateId(hit.objectID),
      title: hit.title,
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      source: source.id,
      sourceName: source.name,
      date: hit.created_at,
      summary: '',
      score: hit.points,
      fetchedAt: new Date().toISOString(),
    }));
}

async function fetchArxiv(source: SourceDefinition): Promise<RawArticle[]> {
  const url = 'https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.LG&start=0&max_results=30&sortBy=submittedDate&sortOrder=descending';
  const response = await requestUrl({ url, method: 'GET' });
  const parser = new DOMParser();
  const doc = parser.parseFromString(response.text, 'text/xml');

  const articles: RawArticle[] = [];
  const sevenDaysAgo = daysAgo(7);

  doc.querySelectorAll('entry').forEach(entry => {
    const title = entry.querySelector('title')?.textContent?.replace(/\n/g, ' ').trim() || '';
    const linkEl = entry.querySelector('link[title="pdf"]') || entry.querySelector('link[href]');
    const link = linkEl?.getAttribute('href') || '';
    const summary = entry.querySelector('summary')?.textContent?.replace(/\n/g, ' ').trim() || '';
    const published = entry.querySelector('published')?.textContent || '';
    const date = published ? new Date(published) : new Date();

    const arxivId = link.match(/(\d{4}\.\d{4,5})/)?.[1] || '';

    if (date < sevenDaysAgo || !title) return;

    articles.push({
      id: generateId(arxivId || link),
      title,
      url: arxivId ? `https://arxiv.org/abs/${arxivId}` : link,
      source: source.id,
      sourceName: source.name,
      date: date.toISOString(),
      summary: truncate(summary, 500),
      fetchedAt: new Date().toISOString(),
    });
  });

  return articles;
}

async function fetchRedditML(source: SourceDefinition): Promise<RawArticle[]> {
  const response = await requestUrl({
    url: 'https://www.reddit.com/r/MachineLearning/hot.json?limit=25',
    method: 'GET',
    headers: { 'User-Agent': 'obsidian-ai-briefing/1.0' },
  });
  const data: { data: { children: Array<{ data: {
    id: string; title: string; url: string; permalink: string;
    score: number; created_utc: number; selftext: string; stickied: boolean;
    is_self: boolean;
  } }> } } = response.json;

  return data.data.children
    .filter(c => !c.data.stickied && c.data.score >= 20)
    .map(c => {
      const d = c.data;
      return {
        id: generateId(d.id),
        title: d.title,
        url: d.is_self ? `https://reddit.com${d.permalink}` : d.url,
        source: source.id,
        sourceName: source.name,
        date: new Date(d.created_utc * 1000).toISOString(),
        summary: truncate(stripHtml(d.selftext || ''), 500),
        score: d.score,
        fetchedAt: new Date().toISOString(),
      };
    });
}

async function fetchGitHubTrending(source: SourceDefinition): Promise<RawArticle[]> {
  const sevenDaysAgoStr = daysAgo(7).toISOString().split('T')[0];
  const query = encodeURIComponent(`topic:machine-learning OR topic:artificial-intelligence OR topic:llm created:>${sevenDaysAgoStr}`);
  const url = `https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=15`;

  const response = await requestUrl({
    url,
    method: 'GET',
    headers: { 'User-Agent': 'obsidian-ai-briefing/1.0' },
  });
  const data: { items: Array<{
    full_name: string; html_url: string; description: string;
    stargazers_count: number; created_at: string;
  }> } = response.json;

  return data.items.map(repo => ({
    id: generateId(repo.full_name),
    title: repo.full_name,
    url: repo.html_url,
    source: source.id,
    sourceName: source.name,
    date: repo.created_at,
    summary: truncate(repo.description || '', 500),
    score: repo.stargazers_count,
    fetchedAt: new Date().toISOString(),
  }));
}

// ============================================================================
// SOURCE DEFINITIONS
// ============================================================================

const FETCH_FUNCTIONS: Record<string, (source: SourceDefinition) => Promise<RawArticle[]>> = {
  'rss': fetchRSS,
  'huggingface-papers': fetchHuggingFacePapers,
  'hacker-news-ai': fetchHackerNews,
  'arxiv-cs-ai': fetchArxiv,
  'reddit-ml': fetchRedditML,
  'github-trending': fetchGitHubTrending,
};

const DEFAULT_SOURCES: SourceDefinition[] = [
  // RSS Feeds
  { id: 'mit-tech-review',  name: 'MIT Technology Review AI', type: 'rss', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', category: 'RSS Feeds', enabled: true },
  { id: 'the-batch',        name: 'The Batch (deeplearning.ai)', type: 'rss', url: 'https://www.deeplearning.ai/the-batch/feed/', category: 'RSS Feeds', enabled: true },
  { id: 'google-ai-blog',   name: 'Google AI Blog', type: 'rss', url: 'https://blog.google/technology/ai/rss/', category: 'RSS Feeds', enabled: true },
  { id: 'openai-blog',      name: 'OpenAI Blog', type: 'rss', url: 'https://openai.com/blog/rss.xml', category: 'RSS Feeds', enabled: true },
  { id: 'anthropic-blog',   name: 'Anthropic Research', type: 'rss', url: 'https://www.anthropic.com/rss/research', category: 'RSS Feeds', enabled: true },
  { id: 'import-ai',        name: 'Import AI Newsletter', type: 'rss', url: 'https://importai.substack.com/feed', category: 'RSS Feeds', enabled: true },
  { id: 'the-gradient',     name: 'The Gradient', type: 'rss', url: 'https://thegradient.pub/rss/', category: 'RSS Feeds', enabled: true },
  { id: 'ahead-of-ai',      name: 'Ahead of AI (Raschka)', type: 'rss', url: 'https://magazine.sebastianraschka.com/feed', category: 'RSS Feeds', enabled: true },
  { id: 'ai-news',          name: 'AI News', type: 'rss', url: 'https://www.artificialintelligence-news.com/feed/', category: 'RSS Feeds', enabled: true },
  // API Sources
  { id: 'huggingface-papers', name: 'HuggingFace Daily Papers', type: 'api', url: 'https://huggingface.co/api/daily_papers', category: 'API Sources', enabled: true },
  { id: 'hacker-news-ai',    name: 'Hacker News (AI)', type: 'api', url: 'https://hn.algolia.com/api/v1/search', category: 'API Sources', enabled: true },
  { id: 'arxiv-cs-ai',       name: 'ArXiv (cs.AI + cs.LG)', type: 'api', url: 'https://export.arxiv.org/api/query', category: 'API Sources', enabled: true },
  { id: 'reddit-ml',         name: 'Reddit r/MachineLearning', type: 'api', url: 'https://www.reddit.com/r/MachineLearning/hot.json', category: 'API Sources', enabled: true },
  { id: 'github-trending',   name: 'GitHub Trending (AI/ML)', type: 'api', url: 'https://api.github.com/search/repositories', category: 'API Sources', enabled: false },
];

function getFetchFunction(source: SourceDefinition): (source: SourceDefinition) => Promise<RawArticle[]> {
  if (source.type === 'rss') return FETCH_FUNCTIONS['rss'];
  return FETCH_FUNCTIONS[source.id] || FETCH_FUNCTIONS['rss'];
}

function getActiveSources(settings: AIWeeklySettings): SourceDefinition[] {
  const sources = DEFAULT_SOURCES.map(s => ({
    ...s,
    enabled: settings.sourceOverrides[s.id] !== undefined ? settings.sourceOverrides[s.id] : s.enabled,
  }));

  const custom: SourceDefinition[] = settings.customSources.map(c => ({
    id: c.id,
    name: c.name,
    type: 'rss' as SourceType,
    url: c.url,
    category: 'Custom Feeds',
    enabled: c.enabled,
  }));

  return [...sources, ...custom];
}

// ============================================================================
// COLLECTION ENGINE
// ============================================================================

function deduplicateArticles(articles: RawArticle[]): RawArticle[] {
  const seen = new Map<string, RawArticle>();
  for (const article of articles) {
    const key = normalizeUrl(article.url);
    const existing = seen.get(key);
    if (!existing || (article.summary.length > existing.summary.length) || ((article.score || 0) > (existing.score || 0))) {
      seen.set(key, article);
    }
  }
  return Array.from(seen.values());
}

async function collectArticles(
  sources: SourceDefinition[],
  existingArticles: RawArticle[]
): Promise<{ articles: RawArticle[]; errors: SourceError[] }> {
  const enabledSources = sources.filter(s => s.enabled);
  const errors: SourceError[] = [];

  const results = await Promise.allSettled(
    enabledSources.map(async source => {
      const fetchFn = getFetchFunction(source);
      return withRetry(() => fetchFn(source));
    })
  );

  const newArticles: RawArticle[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      newArticles.push(...result.value);
    } else {
      const source = enabledSources[index];
      errors.push({
        sourceId: source.id,
        sourceName: source.name,
        error: result.reason?.message || String(result.reason),
      });
      console.warn(`AI Briefing: ${source.name} failed: ${sanitizeError(result.reason)}`);
    }
  });

  const merged = deduplicateArticles([...existingArticles, ...newArticles]);
  const fourteenDaysAgo = daysAgo(14);
  const pruned = merged.filter(a => new Date(a.fetchedAt) >= fourteenDaysAgo);

  return { articles: pruned, errors };
}

// ============================================================================
// LLM PROVIDERS
// ============================================================================

function buildCurationPrompt(articles: RawArticle[], language: 'en' | 'no', maxArticles: number): { system: string; user: string } {
  const langInstruction = language === 'no'
    ? 'Write all summaries in Norwegian (Norsk bokmål).'
    : 'Write all summaries in English.';

  const categories = ARTICLE_CATEGORIES.join(', ');

  const system = `You are an AI news curator. Your job is to select the most important and interesting articles from a collection of AI news, research papers, and blog posts.

Instructions:
- Select the top ${maxArticles} most relevant articles
- For each article, assign exactly one category from: ${categories}
- Write a concise 1-3 sentence summary for each article
- Score each article's relevance from 1-10
- Pick one "Article of the Week" — the single most impactful item
- ${langInstruction}
- Return ONLY valid JSON, no markdown fences or other text

Return this exact JSON structure:
{
  "articles": [
    {
      "id": "original article id",
      "title": "article title",
      "url": "article url",
      "source": "source id",
      "sourceName": "source name",
      "date": "ISO date",
      "summary": "your curated summary",
      "category": "one of the categories",
      "relevanceScore": 8,
      "isArticleOfTheWeek": false
    }
  ],
  "articleOfTheWeekId": "id of the top article"
}`;

  const compactArticles = articles.map(a => ({
    id: a.id,
    title: a.title,
    url: a.url,
    source: a.source,
    sourceName: a.sourceName,
    date: a.date,
    summary: truncate(a.summary, 200),
    score: a.score,
  }));

  const user = `Here are ${articles.length} articles to curate:\n\n${JSON.stringify(compactArticles)}`;

  return { system, user };
}

function parseCurationResponse(raw: string): CurationResult {
  let cleaned = raw.trim();
  // Strip markdown code fences
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  const parsed = JSON.parse(cleaned);

  if (!parsed.articles || !Array.isArray(parsed.articles)) {
    throw new Error('Invalid curation response: missing articles array');
  }

  const articles: CuratedArticle[] = parsed.articles.map((a: Record<string, unknown>) => ({
    id: String(a.id || ''),
    title: String(a.title || ''),
    url: String(a.url || ''),
    source: String(a.source || ''),
    sourceName: String(a.sourceName || ''),
    date: String(a.date || ''),
    summary: String(a.summary || ''),
    originalSummary: '',
    category: ARTICLE_CATEGORIES.includes(a.category as ArticleCategory)
      ? (a.category as ArticleCategory)
      : 'Industry News',
    relevanceScore: typeof a.relevanceScore === 'number' ? a.relevanceScore : 5,
    isArticleOfTheWeek: Boolean(a.isArticleOfTheWeek),
    included: true,
  }));

  return {
    articles,
    articleOfTheWeekId: String(parsed.articleOfTheWeekId || ''),
  };
}

// Anthropic provider
async function callAnthropic(settings: AIWeeklySettings, system: string, user: string): Promise<string> {
  const response = await requestUrl({
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    headers: {
      'x-api-key': settings.anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.anthropicModel,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  const data = response.json;
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.content[0].text;
}

// OpenAI-compatible provider (covers OpenAI, Groq, OpenRouter, Mistral)
async function callOpenAICompatible(settings: AIWeeklySettings, system: string, user: string): Promise<string> {
  const endpoint = settings.openaiCompatEndpoint.replace(/\/$/, '');
  const response = await requestUrl({
    url: `${endpoint}/chat/completions`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${settings.openaiCompatApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.openaiCompatModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  });
  const data = response.json;
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.choices[0].message.content;
}

// Google Gemini provider
// Note: Gemini API requires the key as a query parameter — this is Google's standard
// auth method for this endpoint. The key is sent over HTTPS so it's encrypted in transit.
async function callGemini(settings: AIWeeklySettings, system: string, user: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.geminiModel)}:generateContent?key=${encodeURIComponent(settings.geminiApiKey)}`;
  const response = await requestUrl({
    url,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.3,
      },
    }),
  });
  const data = response.json;
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.candidates[0].content.parts[0].text;
}

// Ollama provider
async function callOllama(settings: AIWeeklySettings, system: string, user: string): Promise<string> {
  const endpoint = settings.ollamaEndpoint.replace(/\/$/, '');
  const response = await requestUrl({
    url: `${endpoint}/api/chat`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.ollamaModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: false,
      format: 'json',
    }),
  });
  const data = response.json;
  return data.message.content;
}

function createLLMProvider(settings: AIWeeklySettings): LLMProvider {
  const callFn = ((): (settings: AIWeeklySettings, system: string, user: string) => Promise<string> => {
    switch (settings.llmProvider) {
      case 'anthropic': return callAnthropic;
      case 'openai-compatible': return callOpenAICompatible;
      case 'gemini': return callGemini;
      case 'ollama': return callOllama;
    }
  })();

  return {
    type: settings.llmProvider,
    async curate(articles: RawArticle[], language: 'en' | 'no', maxArticles: number): Promise<CurationResult> {
      // Trim articles for small context models
      const maxInput = settings.llmProvider === 'ollama' ? 50 : 150;
      const sorted = [...articles].sort((a, b) => {
        const scoreDiff = (b.score || 0) - (a.score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });
      const trimmed = sorted.slice(0, maxInput);

      const { system, user } = buildCurationPrompt(trimmed, language, maxArticles);
      const raw = await withRetry(() => callFn(settings, system, user));
      const result = parseCurationResponse(raw);

      // Restore original summaries
      const articleMap = new Map(articles.map(a => [a.id, a]));
      result.articles.forEach(a => {
        const original = articleMap.get(a.id);
        if (original) a.originalSummary = original.summary;
      });

      return result;
    },
  };
}

// ============================================================================
// NOTE GENERATOR
// ============================================================================

function generateNoteContent(result: CurationResult, settings: AIWeeklySettings): string {
  const now = new Date();
  const { week, year } = getISOWeekNumber(now);
  const dateStr = todayStr();

  const includedArticles = result.articles.filter(a => a.included);
  const articleOfTheWeek = includedArticles.find(a => a.id === result.articleOfTheWeekId && a.included)
    || includedArticles.find(a => a.isArticleOfTheWeek);

  // Collect unique categories for tags
  const categories = new Set<ArticleCategory>();
  includedArticles.forEach(a => categories.add(a.category));
  const tags = ['ai-briefing', ...Array.from(categories).map(categoryToTag)];

  // Unique sources
  const sourceNames = new Set(includedArticles.map(a => a.sourceName));

  // YAML frontmatter
  let md = '---\n';
  md += `date: ${dateStr}\n`;
  md += `week: ${week}\n`;
  md += `year: ${year}\n`;
  md += `tags:\n`;
  tags.forEach(t => { md += `  - ${t}\n`; });
  md += `sources: ${sourceNames.size}\n`;
  md += `articles: ${includedArticles.length}\n`;
  md += `generated: ${now.toISOString()}\n`;
  md += '---\n\n';

  // Title
  md += `# AI Briefing - Week ${week}, ${year}\n\n`;

  // Article of the Week
  if (articleOfTheWeek) {
    md += `> [!tip] Article of the Week\n`;
    md += `> ## [${articleOfTheWeek.title}](${articleOfTheWeek.url})\n`;
    md += `> **Source:** ${articleOfTheWeek.sourceName} | **Relevance:** ${articleOfTheWeek.relevanceScore}/10\n`;
    md += `>\n`;
    md += `> ${articleOfTheWeek.summary}\n\n`;
    md += '---\n\n';
  }

  // Group by category
  const grouped = new Map<ArticleCategory, CuratedArticle[]>();
  for (const cat of ARTICLE_CATEGORIES) {
    const catArticles = includedArticles.filter(a => a.category === cat && a.id !== articleOfTheWeek?.id);
    if (catArticles.length > 0) {
      grouped.set(cat, catArticles.sort((a, b) => b.relevanceScore - a.relevanceScore));
    }
  }

  for (const [cat, catArticles] of grouped) {
    md += `## ${cat}\n\n`;
    for (const article of catArticles) {
      md += `- **[${article.title}](${article.url})** — *${article.sourceName}* (${article.relevanceScore}/10)\n`;
      md += `  ${article.summary}\n\n`;
    }
  }

  // Reflections section
  md += '---\n\n';
  md += '## My Reflections\n\n';
  md += '*Add your thoughts and reflections here...*\n\n';

  // Footer
  md += '---\n';
  md += `*Generated by AI Briefing on ${dateStr}*\n`;

  return md;
}

async function saveDigestNote(app: App, result: CurationResult, settings: AIWeeklySettings): Promise<void> {
  const content = generateNoteContent(result, settings);
  const { week, year } = getISOWeekNumber(new Date());
  const folderPath = settings.outputFolder;
  let fileName = `AI Briefing - Week ${week}, ${year}.md`;
  let fullPath = `${folderPath}/${fileName}`;

  // Ensure folder exists
  if (!app.vault.getAbstractFileByPath(folderPath)) {
    await app.vault.createFolder(folderPath);
  }

  // Handle duplicate filename
  let counter = 1;
  while (app.vault.getAbstractFileByPath(fullPath)) {
    counter++;
    fileName = `AI Briefing - Week ${week}, ${year} (${counter}).md`;
    fullPath = `${folderPath}/${fileName}`;
  }

  const file = await app.vault.create(fullPath, content);
  await app.workspace.getLeaf(false).openFile(file as TFile);
  new Notice(`AI Briefing: Digest saved to ${fullPath}`);
}

// ============================================================================
// PREVIEW MODAL
// ============================================================================

class DigestPreviewModal extends Modal {
  private result: CurationResult;
  private settings: AIWeeklySettings;
  private onConfirm: (result: CurationResult) => void;
  private checkboxes: Map<string, HTMLInputElement> = new Map();

  constructor(app: App, result: CurationResult, settings: AIWeeklySettings, onConfirm: (result: CurationResult) => void) {
    super(app);
    this.result = result;
    this.settings = settings;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('ai-weekly-preview-modal');
    this.renderContent();
  }

  onClose() {
    this.contentEl.empty();
  }

  private renderContent() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'AI Briefing Preview' });

    const articleCount = this.result.articles.length;
    contentEl.createEl('p', {
      text: `${articleCount} articles curated. Uncheck any you want to exclude.`,
      cls: 'setting-item-description',
    });

    // Article of the Week
    const aotw = this.result.articles.find(a => a.id === this.result.articleOfTheWeekId)
      || this.result.articles.find(a => a.isArticleOfTheWeek);
    if (aotw) {
      const aotwContainer = contentEl.createDiv({ cls: 'ai-weekly-article-of-week' });
      aotwContainer.createEl('h3', { text: 'Article of the Week' });
      this.renderArticleRow(aotwContainer, aotw);
    }

    // Group by category
    for (const cat of ARTICLE_CATEGORIES) {
      const catArticles = this.result.articles.filter(a => a.category === cat && a.id !== aotw?.id);
      if (catArticles.length === 0) continue;

      const section = contentEl.createEl('details', { cls: 'ai-weekly-category-section' });
      section.setAttribute('open', '');
      section.createEl('summary', { text: `${cat} (${catArticles.length})` });

      for (const article of catArticles.sort((a, b) => b.relevanceScore - a.relevanceScore)) {
        this.renderArticleRow(section, article);
      }
    }

    // Button bar
    const buttonBar = contentEl.createDiv({ cls: 'ai-weekly-button-bar' });
    const leftButtons = buttonBar.createDiv({ cls: 'ai-weekly-button-bar-left' });
    const rightButtons = buttonBar.createDiv({ cls: 'ai-weekly-button-bar-right' });

    const selectAllBtn = leftButtons.createEl('button', { text: 'Select All' });
    selectAllBtn.addEventListener('click', () => {
      this.checkboxes.forEach((cb) => { cb.checked = true; });
      this.result.articles.forEach(a => { a.included = true; });
    });

    const deselectAllBtn = leftButtons.createEl('button', { text: 'Deselect All' });
    deselectAllBtn.addEventListener('click', () => {
      this.checkboxes.forEach((cb) => { cb.checked = false; });
      this.result.articles.forEach(a => { a.included = false; });
    });

    const cancelBtn = rightButtons.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());

    const confirmBtn = rightButtons.createEl('button', { text: 'Generate Digest', cls: 'mod-cta' });
    confirmBtn.addEventListener('click', () => {
      this.onConfirm(this.result);
      this.close();
    });
  }

  private renderArticleRow(container: HTMLElement, article: CuratedArticle) {
    const row = container.createDiv({ cls: 'ai-weekly-article-row' });

    const checkbox = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
    checkbox.checked = article.included;
    checkbox.addEventListener('change', () => { article.included = checkbox.checked; });
    this.checkboxes.set(article.id, checkbox);

    const info = row.createDiv({ cls: 'ai-weekly-article-info' });

    const titleDiv = info.createDiv({ cls: 'ai-weekly-article-title' });
    const link = titleDiv.createEl('a', { text: article.title, href: article.url });
    link.setAttr('target', '_blank');

    const meta = info.createDiv({ cls: 'ai-weekly-article-meta' });
    meta.createSpan({ text: article.sourceName, cls: 'ai-weekly-source-badge' });
    meta.createSpan({ text: `${article.relevanceScore}/10`, cls: 'ai-weekly-score' });
    meta.createSpan({ text: article.category, cls: 'ai-weekly-source-badge' });

    if (article.summary) {
      info.createDiv({ text: article.summary, cls: 'ai-weekly-article-summary' });
    }
  }
}

// ============================================================================
// SETTINGS TAB
// ============================================================================

class AIWeeklySettingTab extends PluginSettingTab {
  plugin: AIWeeklyPlugin;

  constructor(app: App, plugin: AIWeeklyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderLLMSection(containerEl);
    this.renderSourcesSection(containerEl);
    this.renderScheduleSection(containerEl);
    this.renderOutputSection(containerEl);
    this.renderManualControls(containerEl);
  }

  private renderLLMSection(containerEl: HTMLElement) {
    const section = containerEl.createDiv({ cls: 'ai-weekly-settings-section' });
    section.createEl('h3', { text: 'LLM Provider' });

    new Setting(section)
      .setName('Provider')
      .setDesc('Choose your LLM provider for article curation')
      .addDropdown(dropdown => dropdown
        .addOption('anthropic', 'Anthropic (Claude)')
        .addOption('openai-compatible', 'OpenAI-Compatible')
        .addOption('gemini', 'Google Gemini')
        .addOption('ollama', 'Ollama (Local)')
        .setValue(this.plugin.settings.llmProvider)
        .onChange(async (value: string) => {
          this.plugin.settings.llmProvider = value as LLMProviderType;
          await this.plugin.saveSettings();
          this.display();
        }));

    switch (this.plugin.settings.llmProvider) {
      case 'anthropic':
        new Setting(section)
          .setName('API Key')
          .setDesc('Your Anthropic API key')
          .addText(text => {
            text.inputEl.type = 'password';
            text.inputEl.autocomplete = 'off';
            text.setPlaceholder('sk-ant-...')
              .setValue(this.plugin.settings.anthropicApiKey)
              .onChange(async (value) => {
                this.plugin.settings.anthropicApiKey = value;
                await this.plugin.saveSettings();
              });
          });
        new Setting(section)
          .setName('Model')
          .addDropdown(dropdown => dropdown
            .addOption('claude-haiku-4-5-20251001', 'Claude Haiku 4.5')
            .addOption('claude-sonnet-4-20250514', 'Claude Sonnet 4')
            .addOption('claude-opus-4-20250514', 'Claude Opus 4')
            .setValue(this.plugin.settings.anthropicModel)
            .onChange(async (value) => {
              this.plugin.settings.anthropicModel = value;
              await this.plugin.saveSettings();
            }));
        break;

      case 'openai-compatible':
        new Setting(section)
          .setName('Service Preset')
          .setDesc('Select a service or use a custom endpoint')
          .addDropdown(dropdown => {
            for (const [key, preset] of Object.entries(OPENAI_COMPAT_PRESETS)) {
              dropdown.addOption(key, preset.name);
            }
            dropdown
              .setValue(this.plugin.settings.openaiCompatPreset)
              .onChange(async (value: string) => {
                const preset = value as OpenAICompatPreset;
                this.plugin.settings.openaiCompatPreset = preset;
                if (preset !== 'custom') {
                  this.plugin.settings.openaiCompatEndpoint = OPENAI_COMPAT_PRESETS[preset].endpoint;
                  const models = OPENAI_COMPAT_PRESETS[preset].models;
                  if (models.length > 0) {
                    this.plugin.settings.openaiCompatModel = models[0];
                  }
                }
                await this.plugin.saveSettings();
                this.display();
              });
          });
        new Setting(section)
          .setName('Endpoint URL')
          .setDesc('API base URL (e.g. https://api.openai.com/v1)')
          .addText(text => text
            .setPlaceholder('https://api.openai.com/v1')
            .setValue(this.plugin.settings.openaiCompatEndpoint)
            .onChange(async (value) => {
              this.plugin.settings.openaiCompatEndpoint = value;
              await this.plugin.saveSettings();
            }));
        new Setting(section)
          .setName('API Key')
          .addText(text => {
            text.inputEl.type = 'password';
            text.inputEl.autocomplete = 'off';
            text.setPlaceholder('sk-...')
              .setValue(this.plugin.settings.openaiCompatApiKey)
              .onChange(async (value) => {
                this.plugin.settings.openaiCompatApiKey = value;
                await this.plugin.saveSettings();
              });
          });
        {
          const presetModels = OPENAI_COMPAT_PRESETS[this.plugin.settings.openaiCompatPreset].models;
          if (presetModels.length > 0) {
            new Setting(section)
              .setName('Model')
              .addDropdown(dropdown => {
                for (const model of presetModels) {
                  dropdown.addOption(model, model);
                }
                dropdown
                  .setValue(this.plugin.settings.openaiCompatModel)
                  .onChange(async (value) => {
                    this.plugin.settings.openaiCompatModel = value;
                    await this.plugin.saveSettings();
                  });
              });
          } else {
            new Setting(section)
              .setName('Model')
              .setDesc('Enter the model name')
              .addText(text => text
                .setPlaceholder('gpt-4o')
                .setValue(this.plugin.settings.openaiCompatModel)
                .onChange(async (value) => {
                  this.plugin.settings.openaiCompatModel = value;
                  await this.plugin.saveSettings();
                }));
          }
        }
        break;

      case 'gemini':
        new Setting(section)
          .setName('API Key')
          .setDesc('Your Google AI Studio API key')
          .addText(text => {
            text.inputEl.type = 'password';
            text.inputEl.autocomplete = 'off';
            text.setPlaceholder('AIza...')
              .setValue(this.plugin.settings.geminiApiKey)
              .onChange(async (value) => {
                this.plugin.settings.geminiApiKey = value;
                await this.plugin.saveSettings();
              });
          });
        new Setting(section)
          .setName('Model')
          .addDropdown(dropdown => dropdown
            .addOption('gemini-2.0-flash', 'Gemini 2.0 Flash (Free)')
            .addOption('gemini-2.5-pro', 'Gemini 2.5 Pro')
            .addOption('gemini-2.5-flash', 'Gemini 2.5 Flash')
            .setValue(this.plugin.settings.geminiModel)
            .onChange(async (value) => {
              this.plugin.settings.geminiModel = value;
              await this.plugin.saveSettings();
            }));
        break;

      case 'ollama':
        new Setting(section)
          .setName('Endpoint')
          .setDesc('Ollama server URL')
          .addText(text => text
            .setPlaceholder('http://localhost:11434')
            .setValue(this.plugin.settings.ollamaEndpoint)
            .onChange(async (value) => {
              this.plugin.settings.ollamaEndpoint = value;
              await this.plugin.saveSettings();
            }));
        new Setting(section)
          .setName('Model')
          .setDesc('Model name (as pulled in Ollama)')
          .addText(text => text
            .setPlaceholder('llama3')
            .setValue(this.plugin.settings.ollamaModel)
            .onChange(async (value) => {
              this.plugin.settings.ollamaModel = value;
              await this.plugin.saveSettings();
            }));
        break;
    }
  }

  private renderSourcesSection(containerEl: HTMLElement) {
    const section = containerEl.createDiv({ cls: 'ai-weekly-settings-section' });
    section.createEl('h3', { text: 'News Sources' });

    const sources = getActiveSources(this.plugin.settings);
    const groups = new Map<string, SourceDefinition[]>();
    for (const source of sources) {
      const group = groups.get(source.category) || [];
      group.push(source);
      groups.set(source.category, group);
    }

    for (const [groupName, groupSources] of groups) {
      const groupDiv = section.createDiv({ cls: 'ai-weekly-source-group' });
      groupDiv.createEl('h4', { text: groupName });

      for (const source of groupSources) {
        new Setting(groupDiv)
          .setName(source.name)
          .setDesc(truncate(source.url, 60))
          .addToggle(toggle => toggle
            .setValue(source.enabled)
            .onChange(async (value) => {
              // For custom sources, update directly
              const customIdx = this.plugin.settings.customSources.findIndex(c => c.id === source.id);
              if (customIdx >= 0) {
                this.plugin.settings.customSources[customIdx].enabled = value;
              } else {
                this.plugin.settings.sourceOverrides[source.id] = value;
              }
              await this.plugin.saveSettings();
            }));
      }
    }

    // Add custom feed section
    new Setting(section)
      .setName('Add Custom RSS Feed')
      .setDesc('Add your own RSS feed source')
      .addButton(button => button
        .setButtonText('Add Feed')
        .onClick(() => {
          this.renderCustomFeedForm(section);
        }));
  }

  private renderCustomFeedForm(container: HTMLElement) {
    // Remove existing form if any
    const existing = container.querySelector('.ai-weekly-custom-feed-form');
    if (existing) existing.remove();

    const form = container.createDiv({ cls: 'ai-weekly-custom-feed-form' });
    let feedName = '';
    let feedUrl = '';

    new Setting(form)
      .setName('Feed Name')
      .addText(text => text
        .setPlaceholder('My AI Feed')
        .onChange(value => { feedName = value; }));

    new Setting(form)
      .setName('Feed URL')
      .addText(text => text
        .setPlaceholder('https://example.com/feed.xml')
        .onChange(value => { feedUrl = value; }));

    new Setting(form)
      .addButton(button => button
        .setButtonText('Save')
        .setCta()
        .onClick(async () => {
          if (!feedName || !feedUrl) {
            new Notice('Please enter both a name and URL');
            return;
          }
          if (!isValidFeedUrl(feedUrl)) {
            new Notice('Feed URL must be a valid HTTP or HTTPS URL');
            return;
          }
          this.plugin.settings.customSources.push({
            id: `custom-${generateId(feedUrl)}`,
            name: feedName,
            url: feedUrl,
            category: 'Custom Feeds',
            enabled: true,
          });
          await this.plugin.saveSettings();
          this.display();
        }))
      .addButton(button => button
        .setButtonText('Cancel')
        .onClick(() => form.remove()));
  }

  private renderScheduleSection(containerEl: HTMLElement) {
    const section = containerEl.createDiv({ cls: 'ai-weekly-settings-section' });
    section.createEl('h3', { text: 'Schedule' });

    new Setting(section)
      .setName('Automatic daily collection')
      .setDesc('Automatically collect articles from sources daily')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoCollectEnabled)
        .onChange(async (value) => {
          this.plugin.settings.autoCollectEnabled = value;
          await this.plugin.saveSettings();
        }));

    new Setting(section)
      .setName('Collection hour')
      .setDesc('Hour of day to collect articles (24h format)')
      .addSlider(slider => slider
        .setLimits(0, 23, 1)
        .setValue(this.plugin.settings.collectHour)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.collectHour = value;
          await this.plugin.saveSettings();
        }));

    new Setting(section)
      .setName('Automatic weekly digest')
      .setDesc('Automatically generate a digest each week')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoDigestEnabled)
        .onChange(async (value) => {
          this.plugin.settings.autoDigestEnabled = value;
          await this.plugin.saveSettings();
        }));

    new Setting(section)
      .setName('Digest day')
      .setDesc('Day of the week to generate the digest')
      .addDropdown(dropdown => dropdown
        .addOption('0', 'Sunday')
        .addOption('1', 'Monday')
        .addOption('2', 'Tuesday')
        .addOption('3', 'Wednesday')
        .addOption('4', 'Thursday')
        .addOption('5', 'Friday')
        .addOption('6', 'Saturday')
        .setValue(String(this.plugin.settings.digestDay))
        .onChange(async (value) => {
          this.plugin.settings.digestDay = Number(value);
          await this.plugin.saveSettings();
        }));

    new Setting(section)
      .setName('Digest hour')
      .setDesc('Hour of day to generate the digest (24h format)')
      .addSlider(slider => slider
        .setLimits(0, 23, 1)
        .setValue(this.plugin.settings.digestHour)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.digestHour = value;
          await this.plugin.saveSettings();
        }));
  }

  private renderOutputSection(containerEl: HTMLElement) {
    const section = containerEl.createDiv({ cls: 'ai-weekly-settings-section' });
    section.createEl('h3', { text: 'Output' });

    new Setting(section)
      .setName('Output folder')
      .setDesc('Vault-relative path for digest notes')
      .addText(text => text
        .setPlaceholder('AI-Briefing')
        .setValue(this.plugin.settings.outputFolder)
        .onChange(async (value) => {
          this.plugin.settings.outputFolder = value;
          await this.plugin.saveSettings();
        }));

    new Setting(section)
      .setName('Language')
      .setDesc('Language for digest summaries')
      .addDropdown(dropdown => dropdown
        .addOption('en', 'English')
        .addOption('no', 'Norwegian (Norsk)')
        .setValue(this.plugin.settings.language)
        .onChange(async (value: string) => {
          this.plugin.settings.language = value as 'en' | 'no';
          await this.plugin.saveSettings();
        }));

    new Setting(section)
      .setName('Max articles per digest')
      .setDesc('Maximum number of articles in each digest')
      .addSlider(slider => slider
        .setLimits(5, 50, 1)
        .setValue(this.plugin.settings.maxArticlesPerDigest)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxArticlesPerDigest = value;
          await this.plugin.saveSettings();
        }));
  }

  private renderManualControls(containerEl: HTMLElement) {
    const section = containerEl.createDiv({ cls: 'ai-weekly-settings-section' });
    section.createEl('h3', { text: 'Manual Controls' });

    new Setting(section)
      .setName('Collect articles now')
      .setDesc(`Cache has ${this.plugin.cache.articles.length} articles`)
      .addButton(button => button
        .setButtonText('Collect Now')
        .onClick(async () => {
          button.setDisabled(true);
          button.setButtonText('Collecting...');
          await this.plugin.runCollection();
          button.setDisabled(false);
          button.setButtonText('Collect Now');
          this.display();
        }));

    new Setting(section)
      .setName('Generate digest')
      .setDesc('Curate cached articles and create a digest note')
      .addButton(button => button
        .setButtonText('Generate Digest')
        .setCta()
        .onClick(async () => {
          button.setDisabled(true);
          button.setButtonText('Generating...');
          await this.plugin.runDigest();
          button.setDisabled(false);
          button.setButtonText('Generate Digest');
        }));

    new Setting(section)
      .setName('Clear cache')
      .setDesc('Remove all cached articles')
      .addButton(button => button
        .setButtonText('Clear Cache')
        .setWarning()
        .onClick(async () => {
          this.plugin.cache.articles = [];
          await this.plugin.saveCache();
          new Notice('AI Briefing: Cache cleared.');
          this.display();
        }));
  }
}

// ============================================================================
// MAIN PLUGIN CLASS
// ============================================================================

export default class AIWeeklyPlugin extends Plugin {
  settings: AIWeeklySettings = DEFAULT_SETTINGS;
  cache: PluginCache = { articles: [] };

  async onload() {
    await this.loadPluginData();
    this.addSettingTab(new AIWeeklySettingTab(this.app, this));

    this.addCommand({
      id: 'collect-articles',
      name: 'Collect articles now',
      callback: () => this.runCollection(),
    });

    this.addCommand({
      id: 'generate-digest',
      name: 'Generate weekly digest',
      callback: () => this.runDigest(),
    });

    this.addCommand({
      id: 'clear-cache',
      name: 'Clear article cache',
      callback: async () => {
        this.cache.articles = [];
        await this.saveCache();
        new Notice('AI Briefing: Cache cleared.');
      },
    });

    // Schedule checker every 30 minutes
    this.registerInterval(
      window.setInterval(() => this.checkSchedule(), 30 * 60 * 1000) as unknown as number
    );

    // Initial schedule check (delayed to let Obsidian finish loading)
    setTimeout(() => this.checkSchedule(), 10_000);

    console.log('AI Briefing plugin loaded.');
  }

  onunload() {
    console.log('AI Briefing plugin unloaded.');
  }

  async loadPluginData() {
    const data: PersistedData | null = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? {});
    this.cache = data?.cache ?? { articles: [] };
  }

  async saveSettings() {
    await this.saveData({ settings: this.settings, cache: this.cache } as PersistedData);
  }

  async saveCache() {
    await this.saveData({ settings: this.settings, cache: this.cache } as PersistedData);
  }

  async runCollection() {
    new Notice('AI Briefing: Collecting articles...');
    try {
      const sources = getActiveSources(this.settings);
      const previousCount = this.cache.articles.length;
      const { articles, errors } = await collectArticles(sources, this.cache.articles);
      const newCount = articles.length - previousCount;
      this.cache.articles = articles;
      await this.saveCache();

      const enabledCount = sources.filter(s => s.enabled).length;
      if (errors.length > 0) {
        new Notice(`AI Briefing: Collected ${Math.max(0, newCount)} new articles. ${errors.length} of ${enabledCount} source(s) had errors.`);
      } else {
        new Notice(`AI Briefing: Collected ${Math.max(0, newCount)} new articles from ${enabledCount} sources.`);
      }
    } catch (error) {
      new Notice('AI Briefing: Collection failed. Check console for details.');
      console.error('AI Briefing collection error:', sanitizeError(error));
    }
  }

  async runDigest() {
    const sevenDaysAgo = daysAgo(7);
    const weekArticles = this.cache.articles.filter(a => new Date(a.fetchedAt) >= sevenDaysAgo);

    if (weekArticles.length === 0) {
      new Notice('AI Briefing: No articles in cache. Run "Collect articles" first.');
      return;
    }

    const providerName = this.settings.llmProvider === 'openai-compatible'
      ? OPENAI_COMPAT_PRESETS[this.settings.openaiCompatPreset].name
      : this.settings.llmProvider;
    new Notice(`AI Briefing: Curating ${weekArticles.length} articles with ${providerName}...`);

    try {
      const provider = createLLMProvider(this.settings);
      const result = await provider.curate(weekArticles, this.settings.language, this.settings.maxArticlesPerDigest);

      new DigestPreviewModal(
        this.app,
        result,
        this.settings,
        async (confirmedResult: CurationResult) => {
          await saveDigestNote(this.app, confirmedResult, this.settings);
          this.settings.lastDigestWeek = currentWeekStr();
          await this.saveSettings();
        },
      ).open();
    } catch (error) {
      const msg = sanitizeError(error);
      new Notice(`AI Briefing: Digest failed — ${truncate(msg, 100)}`);
      console.error('AI Briefing digest error:', sanitizeError(error));
    }
  }

  private async checkSchedule() {
    const now = new Date();
    const today = todayStr();
    const currentHour = now.getHours();
    const currentDay = now.getDay();

    // Daily collection
    if (
      this.settings.autoCollectEnabled &&
      today !== this.settings.lastCollectionDate &&
      currentHour >= this.settings.collectHour
    ) {
      await this.runCollection();
      this.settings.lastCollectionDate = today;
      await this.saveSettings();
    }

    // Weekly digest
    const weekStr = currentWeekStr();
    if (
      this.settings.autoDigestEnabled &&
      weekStr !== this.settings.lastDigestWeek &&
      currentDay === this.settings.digestDay &&
      currentHour >= this.settings.digestHour
    ) {
      await this.runDigest();
      // lastDigestWeek is set in the modal confirm callback
    }
  }
}

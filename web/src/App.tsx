import {
  ArrowUpDown,
  CircleHelp,
  FileCode2,
  Flame,
  GitBranch,
  Layers,
  RotateCcw,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import {
  Suspense,
  lazy,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { FilterPanel } from './components/FilterPanel';
import { RuleCard } from './components/RuleCard';
import { RuleDetailDialog } from './components/RuleDetailDialog';
import { RuleGeneratorDialog } from './components/RuleGeneratorDialog';
import { ShareDialog } from './components/ShareDialog';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { ToastRegion } from './components/ToastRegion';
import { useLocalStorage } from './hooks/useLocalStorage';

const LazyHelpPage = lazy(() =>
  import('./components/HelpPage').then((mod) => ({ default: mod.HelpPage }))
);

const INITIAL_VISIBLE_RULES = 50;
const LOAD_MORE_BATCH_SIZE = 50;
const ABOVE_THE_FOLD_CARD_COUNT = 10;

interface IndexedRule {
  rule: CanonicalRule;
  searchText: string;
  firstSeenMs: number;
  agentMask: number;
}

const AGENT_BIT: Record<string, number> = Object.fromEntries(
  ALL_AGENTS.map((agent, index) => [agent, 1 << index])
);
import {
  AGENT_LABELS,
  ALL_AGENTS,
  ALL_CATEGORIES,
  type CanonicalRule,
  type FilterState,
  type MinAdoption,
  type RuleDataset,
  type SortOption,
  type ThemeId,
} from './types';

const DEFAULT_FILTERS: FilterState = {
  query: '',
  agents: [],
  categories: [],
  minAdoption: 0,
  sort: 'repos',
};

const SORT_OPTIONS: { id: SortOption; label: string; icon: typeof GitBranch }[] = [
  { id: 'repos', label: 'Most Repos', icon: GitBranch },
  { id: 'weighted', label: 'Star-Weighted', icon: Star },
  { id: 'trending', label: 'Trending / Recent', icon: Flame },
];

function applyThemeToDocument(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
  const scheme = theme === 'dark' || theme === 'terminal' ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.setAttribute('content', scheme);
  }
}

export function App() {
  const [dataset, setDataset] = useState<RuleDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [theme, setTheme] = useLocalStorage<ThemeId>('ruleindex:theme', 'light');
  const [filters, setFilters] = useLocalStorage<FilterState>('ruleindex:filters', DEFAULT_FILTERS);
  const [selectedRuleIds, setSelectedRuleIds] = useLocalStorage<string[]>(
    'ruleindex:selectedRules',
    []
  );

  const [selectedRule, setSelectedRule] = useState<{ rule: CanonicalRule; rank: number } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [urlGeneratorTopN, setUrlGeneratorTopN] = useState<number | null>(null);
  const [urlGeneratorSummaries, setUrlGeneratorSummaries] = useState<boolean | null>(null);
  const [helpDocId, setHelpDocId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('help');
  });
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_RULES);

  const mobileDrawerRef = useRef<HTMLDialogElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  const deferredQuery = useDeferredValue(filters.query);
  const deferredAgents = useDeferredValue(filters.agents);
  const deferredCategories = useDeferredValue(filters.categories);
  const deferredMinAdoption = useDeferredValue(filters.minAdoption);
  const deferredSort = useDeferredValue(filters.sort);

  // Keep help view synced with browser back/forward navigation
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      setHelpDocId(params.get('help'));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateHelpDoc = useCallback((nextDocId: string) => {
    const url = new URL(window.location.href);
    url.search = `?help=${encodeURIComponent(nextDocId)}`;
    url.hash = '';
    window.history.pushState({}, '', url.toString());
    setHelpDocId(nextDocId);
  }, []);

  // Hydrate filters from shared URL query params if present
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.size) return;

    const next: Partial<FilterState> = {};
    const q = params.get('q');
    if (q !== null) next.query = q;

    const agentsParam = params.get('agents');
    if (agentsParam) {
      const validAgents = agentsParam.split(',').filter((a) => (ALL_AGENTS as readonly string[]).includes(a));
      if (validAgents.length > 0) next.agents = validAgents;
    }

    const catsParam = params.get('categories');
    if (catsParam) {
      const validCats = catsParam.split(',').filter((c) => (ALL_CATEGORIES as readonly string[]).includes(c));
      if (validCats.length > 0) next.categories = validCats;
    }

    const minParam = Number(params.get('min'));
    if (minParam === 5 || minParam === 25 || minParam === 100) {
      next.minAdoption = minParam;
    }

    const sortParam = params.get('sort');
    if (sortParam === 'repos' || sortParam === 'weighted' || sortParam === 'trending') {
      next.sort = sortParam;
    }

    if (Object.keys(next).length > 0) {
      setFilters((prev) => ({ ...prev, ...next }));
    }

    const generateParam = params.get('generate');
    if (generateParam === '1' || generateParam === 'true') {
      const topNParam = Number.parseInt(params.get('top_n') ?? '', 10);
      if (!Number.isNaN(topNParam) && topNParam >= 1 && topNParam <= 25) {
        setUrlGeneratorTopN(topNParam);
      }
      const summariesParam = params.get('include_summaries');
      if (summariesParam === '0' || summariesParam === 'false') {
        setUrlGeneratorSummaries(false);
      } else if (summariesParam === '1' || summariesParam === 'true') {
        setUrlGeneratorSummaries(true);
      }
      setGeneratorOpen(true);
    }
  }, [setFilters]);

  // Sync theme to document & <meta name="color-scheme">
  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  // Keep native mobile filter <dialog> synced with state
  useEffect(() => {
    const drawer = mobileDrawerRef.current;
    if (!drawer) return;
    if (mobileDrawerOpen && !drawer.open) {
      drawer.showModal();
    } else if (!mobileDrawerOpen && drawer.open) {
      drawer.close();
    }
  }, [mobileDrawerOpen]);

  // Light-dismiss fallback for mobile filter drawer when closedby is unsupported
  useEffect(() => {
    const drawer = mobileDrawerRef.current;
    if (!drawer || 'closedBy' in HTMLDialogElement.prototype) return;

    const isOutside = (e: PointerEvent) => {
      const rect = drawer.getBoundingClientRect();
      return (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      );
    };

    let pressedOutside = false;
    const onDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) drawer.close();
      pressedOutside = false;
    };
    drawer.addEventListener('pointerdown', onDown);
    drawer.addEventListener('pointerup', onUp);
    return () => {
      drawer.removeEventListener('pointerdown', onDown);
      drawer.removeEventListener('pointerup', onUp);
    };
  }, []);

  // Load static JSON dataset generated by the Python pipeline
  useEffect(() => {
    let cancelled = false;
    const dataUrl = `${import.meta.env.BASE_URL}data/rules.json`;

    fetch(dataUrl)
      .then((resp) => {
        if (!resp.ok) throw new Error(`Failed to load dataset (${resp.status})`);
        return resp.json() as Promise<RuleDataset>;
      })
      .then((json) => {
        if (!cancelled) {
          setDataset(json);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load rules dataset.');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const rules = dataset?.rules ?? [];

  // Build search & sort index once when the dataset loads so filtering/sorting 35k+ rules takes milliseconds
  const indexedRules = useMemo<IndexedRule[]>(() => {
    return rules.map((rule) => {
      let agentMask = 0;
      for (const agent of rule.agents) {
        agentMask |= AGENT_BIT[agent] ?? 0;
      }
      const exampleParts = rule.examples.map((e) => `${e.text} ${e.repo}`).join(' ');
      return {
        rule,
        searchText: `${rule.title} ${rule.summary} ${rule.category} ${rule.agents.join(' ')} ${exampleParts}`.toLowerCase(),
        firstSeenMs: Date.parse(rule.first_seen) || 0,
        agentMask,
      };
    });
  }, [rules]);

  // Facet counts across all rules
  const agentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const agent of ALL_AGENTS) counts[agent] = 0;
    for (const rule of rules) {
      for (const agent of rule.agents) {
        counts[agent] = (counts[agent] ?? 0) + 1;
      }
    }
    return counts;
  }, [rules]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cat of ALL_CATEGORIES) counts[cat] = 0;
    for (const rule of rules) {
      counts[rule.category] = (counts[rule.category] ?? 0) + 1;
    }
    return counts;
  }, [rules]);

  const filteredRules = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    let requiredAgentMask = 0;
    for (const agent of deferredAgents) {
      requiredAgentMask |= AGENT_BIT[agent] ?? 0;
    }
    const categorySet = deferredCategories.length > 0 ? new Set(deferredCategories) : null;

    const matched: IndexedRule[] = [];
    for (const entry of indexedRules) {
      if (entry.rule.adoption_count < deferredMinAdoption) continue;
      if (requiredAgentMask !== 0 && (entry.agentMask & requiredAgentMask) === 0) continue;
      if (categorySet !== null && !categorySet.has(entry.rule.category)) continue;
      if (q && !entry.searchText.includes(q)) continue;
      matched.push(entry);
    }

    if (deferredSort === 'weighted') {
      matched.sort(
        (a, b) =>
          b.rule.weighted_score - a.rule.weighted_score ||
          b.rule.adoption_count - a.rule.adoption_count
      );
    } else if (deferredSort === 'trending') {
      matched.sort(
        (a, b) =>
          b.firstSeenMs - a.firstSeenMs || b.rule.weighted_score - a.rule.weighted_score
      );
    } else {
      matched.sort(
        (a, b) =>
          b.rule.adoption_count - a.rule.adoption_count ||
          b.rule.weighted_score - a.rule.weighted_score
      );
    }

    return matched.map((entry) => entry.rule);
  }, [deferredAgents, deferredCategories, deferredMinAdoption, deferredQuery, deferredSort, indexedRules]);

  // Reset rendered window whenever the filtered/sorted list changes
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_RULES);
  }, [deferredAgents, deferredCategories, deferredMinAdoption, deferredQuery, deferredSort]);

  // Automatically reveal more rules as the user scrolls near the bottom
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || visibleCount >= filteredRules.length) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((prev) => Math.min(prev + LOAD_MORE_BATCH_SIZE, filteredRules.length));
        }
      },
      { rootMargin: '800px 0px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filteredRules.length, visibleCount]);

  const visibleRules = useMemo(
    () => filteredRules.slice(0, visibleCount),
    [filteredRules, visibleCount]
  );

  const handleSelectRule = useCallback((rule: CanonicalRule, rank: number) => {
    setSelectedRule({ rule, rank });
  }, []);

  const selectedRuleIdSet = useMemo(() => new Set(selectedRuleIds), [selectedRuleIds]);

  const manualSelectedRules = useMemo(() => {
    if (selectedRuleIds.length === 0 || rules.length === 0) return [];
    const byId = new Map<string, CanonicalRule>();
    for (const rule of rules) {
      byId.set(rule.id, rule);
    }
    const resolved: CanonicalRule[] = [];
    for (const id of selectedRuleIds) {
      const found = byId.get(id);
      if (found) resolved.push(found);
    }
    return resolved;
  }, [rules, selectedRuleIds]);

  const allSortedRules = useMemo(() => {
    if (!generatorOpen) return [];
    const copy = [...indexedRules];
    if (deferredSort === 'weighted') {
      copy.sort(
        (a, b) =>
          b.rule.weighted_score - a.rule.weighted_score ||
          b.rule.adoption_count - a.rule.adoption_count
      );
    } else if (deferredSort === 'trending') {
      copy.sort(
        (a, b) =>
          b.firstSeenMs - a.firstSeenMs || b.rule.weighted_score - a.rule.weighted_score
      );
    } else {
      copy.sort(
        (a, b) =>
          b.rule.adoption_count - a.rule.adoption_count ||
          b.rule.weighted_score - a.rule.weighted_score
      );
    }
    return copy.map((entry) => entry.rule);
  }, [deferredSort, generatorOpen, indexedRules]);

  const toggleSelectRule = useCallback(
    (ruleId: string) => {
      setSelectedRuleIds((prev) =>
        prev.includes(ruleId) ? prev.filter((id) => id !== ruleId) : [...prev, ruleId]
      );
    },
    [setSelectedRuleIds]
  );

  const removeSelectedRule = useCallback(
    (ruleId: string) => {
      setSelectedRuleIds((prev) => prev.filter((id) => id !== ruleId));
    },
    [setSelectedRuleIds]
  );

  const clearSelectedRules = useCallback(() => {
    setSelectedRuleIds([]);
  }, [setSelectedRuleIds]);

  const activeFilterCount =
    filters.agents.length +
    filters.categories.length +
    (filters.minAdoption > 0 ? 1 : 0) +
    (filters.query.trim() ? 1 : 0);

  const hasActiveFilters = activeFilterCount > 0;

  const toggleAgent = useCallback(
    (agent: string) => {
      setFilters((prev) => ({
        ...prev,
        agents: prev.agents.includes(agent)
          ? prev.agents.filter((a) => a !== agent)
          : [...prev.agents, agent],
      }));
    },
    [setFilters]
  );

  const clearAgents = useCallback(() => {
    setFilters((prev) => ({ ...prev, agents: [] }));
  }, [setFilters]);

  const toggleCategory = useCallback(
    (category: string) => {
      setFilters((prev) => ({
        ...prev,
        categories: prev.categories.includes(category)
          ? prev.categories.filter((c) => c !== category)
          : [...prev.categories, category],
      }));
    },
    [setFilters]
  );

  const setMinAdoption = useCallback(
    (minAdoption: MinAdoption) => {
      setFilters((prev) => ({ ...prev, minAdoption }));
    },
    [setFilters]
  );

  const setSort = useCallback(
    (sort: SortOption) => {
      setFilters((prev) => ({ ...prev, sort }));
    },
    [setFilters]
  );

  const resetFilters = useCallback(() => {
    setFilters((prev) => ({
      ...DEFAULT_FILTERS,
      sort: prev.sort,
    }));
  }, [setFilters]);

  const handleCopyRule = useCallback((rule: CanonicalRule) => {
    const markdown = `- **${rule.title}**: ${rule.summary}`;
    const showSuccess = () => {
      setCopiedId(rule.id);
      setToastMessage('Copied markdown rule to clipboard');
      window.setTimeout(() => {
        setCopiedId((cur) => (cur === rule.id ? null : cur));
      }, 1800);
    };

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(markdown).then(showSuccess).catch(() => {
        setToastMessage('Could not access clipboard');
      });
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = markdown;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showSuccess();
    }
  }, []);

  const updatedLabel = useMemo(() => {
    if (!dataset?.generated_at) return 'Daily sync';
    try {
      const formatted = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC',
      }).format(new Date(dataset.generated_at));
      return `${formatted} UTC`;
    } catch {
      return dataset.generated_at;
    }
  }, [dataset?.generated_at]);

  if (helpDocId !== null) {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
            Loading documentation…
          </div>
        }
      >
        <LazyHelpPage
          docId={helpDocId}
          theme={theme}
          onChangeTheme={setTheme}
          onNavigateDoc={navigateHelpDoc}
        />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Sticky Top Header */}
      <header
        className="sticky top-0 z-30 border-b backdrop-blur-md"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--bg-surface) 90%, transparent)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-3 py-2 sm:px-6 sm:py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 sm:gap-2.5">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl font-bold shadow-sm sm:h-9 sm:w-9"
                style={{ backgroundColor: 'var(--accent)', color: '#ffffff' }}
                aria-hidden="true"
              >
                <Sparkles className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <span
                    className="text-sm font-bold leading-5 tracking-tight sm:text-lg sm:leading-7"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    RuleIndex
                  </span>
                  <button
                    type="button"
                    onClick={() => setShareOpen(true)}
                    aria-label="Share RuleIndex"
                    title="Share RuleIndex"
                    className="inline-flex h-5 shrink-0 items-center justify-center rounded-md border px-1.5 transition-colors cursor-pointer sm:h-7"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      borderColor: 'var(--border-subtle)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <Share2 className="h-3 w-3 sm:h-4 sm:w-4" aria-hidden="true" />
                  </button>
                </div>
                <p className="hidden truncate text-xs md:block" style={{ color: 'var(--text-muted)' }}>
                  Canonical AI coding agent rules clustered from public GitHub repositories
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <ThemeSwitcher theme={theme} onChange={setTheme} />
              <a
                href={`${import.meta.env.BASE_URL}?help=overview`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open Help"
                title="Help & Documentation"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors sm:h-9 sm:w-9"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-secondary)',
                }}
              >
                <CircleHelp className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </div>

          {/* Mobile / Tablet Filters & Generator Triggers directly below the title */}
          <div className="flex items-center gap-2 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              aria-label="Open filters"
              aria-expanded={mobileDrawerOpen}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Filters</span>
              {activeFilterCount > 0 && (
                <span
                  className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold"
                  style={{ backgroundColor: 'var(--accent)', color: '#ffffff' }}
                >
                  {activeFilterCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setGeneratorOpen(true)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold cursor-pointer"
              style={{
                backgroundColor: 'var(--accent-soft)',
                borderColor: 'var(--accent)',
                color: 'var(--accent-text)',
              }}
            >
              <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Generate Rules</span>
              {manualSelectedRules.length > 0 && (
                <span
                  className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold"
                  style={{ backgroundColor: 'var(--accent)', color: '#ffffff' }}
                >
                  {manualSelectedRules.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-3 sm:px-6 sm:py-5 lg:py-6">
        {/* Compact Hero Stats Strip */}
        <section
          aria-label="Dataset summary"
          className="mb-3 grid grid-cols-[1fr_1fr_1.45fr] gap-2 rounded-2xl border px-2.5 py-2.5 sm:mb-4 sm:grid-cols-3 sm:gap-4 sm:p-4"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[10px] font-medium sm:text-xs" style={{ color: 'var(--text-muted)' }}>
              Canonical Rules
            </span>
            <span className="text-[11px] font-semibold tabular-nums sm:text-base" style={{ color: 'var(--text-primary)' }}>
              {dataset ? dataset.stats.total_rules.toLocaleString() : '—'}
            </span>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[10px] font-medium sm:text-xs" style={{ color: 'var(--text-muted)' }}>
              Repos Indexed
            </span>
            <span className="text-[11px] font-semibold tabular-nums sm:text-base" style={{ color: 'var(--text-primary)' }}>
              {dataset ? dataset.stats.total_repos_indexed.toLocaleString() : '—'}
            </span>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[10px] font-medium sm:text-xs" style={{ color: 'var(--text-muted)' }}>
              Last Updated
            </span>
            <span className="text-[11px] font-semibold leading-tight sm:text-base" style={{ color: 'var(--text-primary)' }}>
              {updatedLabel}
            </span>
          </div>
        </section>

        <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-start lg:gap-5">
          {/* Desktop Sticky Sidebar */}
          <aside
            aria-label="Rule filters"
            className="hidden w-72 shrink-0 rounded-2xl border p-5 lg:sticky lg:top-20 lg:block lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <FilterPanel
              filters={filters}
              agentCounts={agentCounts}
              categoryCounts={categoryCounts}
              hasActiveFilters={hasActiveFilters}
              onToggleAgent={toggleAgent}
              onClearAgents={clearAgents}
              onToggleCategory={toggleCategory}
              onSetMinAdoption={setMinAdoption}
              onReset={resetFilters}
            />
          </aside>

          {/* Leaderboard Column */}
          <div className="min-w-0 flex-1">
            {/* Search & Sort Controls */}
            <div
              className="mb-3 flex flex-col gap-2.5 rounded-2xl border p-2.5 sm:mb-4 sm:gap-3 sm:p-4"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-subtle)',
              }}
            >
              <div className="flex flex-col gap-2 sm:gap-3 md:flex-row md:items-center">
                <div className="relative flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 sm:h-4 sm:w-4"
                    style={{ color: 'var(--text-muted)' }}
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={filters.query}
                    onChange={(e) => setFilters((prev) => ({ ...prev, query: e.target.value }))}
                    placeholder="Search rules, conventions, agents, or repos..."
                    aria-label="Search distilled rules"
                    className="min-h-9 w-full rounded-xl border py-1.5 pl-8 pr-8 text-xs sm:min-h-10 sm:py-2 sm:pl-9 sm:pr-9 sm:text-sm"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      borderColor: 'var(--border-subtle)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  {filters.query && (
                    <button
                      type="button"
                      onClick={() => setFilters((prev) => ({ ...prev, query: '' }))}
                      aria-label="Clear search query"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 cursor-pointer"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <X className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>

                {/* Sort Toggles */}
                <div
                  role="group"
                  aria-label="Sort leaderboard"
                  className="inline-flex flex-wrap items-center gap-1 rounded-xl border p-1"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-subtle)',
                  }}
                >
                  <span className="sr-only">Sort by</span>
                  {SORT_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const active = filters.sort === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setSort(opt.id)}
                        aria-pressed={active}
                        className="inline-flex min-h-7 flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer sm:min-h-8 sm:flex-initial sm:gap-1.5 sm:px-2.5 sm:text-xs"
                        style={
                          active
                            ? {
                                backgroundColor: 'var(--bg-surface)',
                                color: 'var(--text-primary)',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                              }
                            : { color: 'var(--text-secondary)' }
                        }
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Active Filter Pills & Live Result Count */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                    <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
                    Showing <strong style={{ color: 'var(--text-primary)' }}>{filteredRules.length}</strong> of{' '}
                    {rules.length} distilled rules
                  </span>

                  {filters.agents.map((agent) => (
                    <button
                      key={`pill-agent-${agent}`}
                      type="button"
                      onClick={() => toggleAgent(agent)}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium cursor-pointer"
                      style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}
                    >
                      <span>{AGENT_LABELS[agent] ?? agent}</span>
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  ))}

                  {filters.categories.map((cat) => (
                    <button
                      key={`pill-cat-${cat}`}
                      type="button"
                      onClick={() => toggleCategory(cat)}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium cursor-pointer"
                      style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}
                    >
                      <span>{cat}</span>
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  ))}

                  {filters.minAdoption > 0 && (
                    <button
                      type="button"
                      onClick={() => setMinAdoption(0)}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium cursor-pointer"
                      style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}
                    >
                      <span>{filters.minAdoption}+ repos</span>
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold cursor-pointer hover:underline"
                      style={{ color: 'var(--accent-text)' }}
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden="true" />
                      Reset Filters
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setGeneratorOpen(true)}
                    className="hidden min-h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer lg:inline-flex"
                    style={{
                      backgroundColor: 'var(--accent-soft)',
                      borderColor: 'var(--accent)',
                      color: 'var(--accent-text)',
                    }}
                  >
                    <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Generate Rules File</span>
                    {manualSelectedRules.length > 0 && (
                      <span
                        className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold"
                        style={{ backgroundColor: 'var(--accent)', color: '#ffffff' }}
                      >
                        {manualSelectedRules.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Loading / Error / Empty / Leaderboard */}
            {loading ? (
              <div className="flex flex-col gap-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="h-32 animate-pulse rounded-2xl border"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      borderColor: 'var(--border-subtle)',
                    }}
                  />
                ))}
              </div>
            ) : error ? (
              <div
                className="rounded-2xl border p-8 text-center"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-strong)',
                }}
              >
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Failed to load RuleIndex dataset
                </p>
                <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {error}
                </p>
              </div>
            ) : filteredRules.length === 0 ? (
              <div
                className="rounded-2xl border p-10 text-center"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-subtle)',
                }}
              >
                <Layers className="mx-auto h-8 w-8" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
                <p className="mt-3 text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  No matching rules found
                </p>
                <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Try broadening your search query or clearing one of your active filters.
                </p>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-4 inline-flex min-h-10 items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold cursor-pointer"
                  style={{ backgroundColor: 'var(--accent)', color: '#ffffff' }}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Reset Filters
                </button>
              </div>
            ) : (
              <>
                <ol
                  className="flex flex-col gap-2 sm:gap-3"
                  aria-label="Ranked AI coding agent rules"
                >
                  {visibleRules.map((rule, index) => (
                    <RuleCard
                      key={rule.id}
                      rule={rule}
                      rank={index + 1}
                      isCopied={copiedId === rule.id}
                      isSelected={selectedRuleIdSet.has(rule.id)}
                      isDeferred={index >= ABOVE_THE_FOLD_CARD_COUNT}
                      selectedAgents={filters.agents}
                      onToggleAgent={toggleAgent}
                      onToggleSelect={toggleSelectRule}
                      onCopyRule={handleCopyRule}
                      onSelectRule={handleSelectRule}
                    />
                  ))}
                </ol>

                {visibleCount < filteredRules.length && (
                  <div
                    ref={loadMoreSentinelRef}
                    className="mt-4 flex flex-col items-center gap-2 py-3 text-center"
                  >
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Showing {visibleRules.length.toLocaleString()} of {filteredRules.length.toLocaleString()} matching rules
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setVisibleCount((prev) => Math.min(prev + LOAD_MORE_BATCH_SIZE, filteredRules.length))
                      }
                      className="inline-flex min-h-9 items-center justify-center rounded-xl border px-4 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        borderColor: 'var(--border-strong)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      Load more rules
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer
        className="mt-6 border-t py-4 text-center text-[11px] sm:mt-8 sm:py-6 sm:text-xs"
        style={{
          borderColor: 'var(--border-subtle)',
          color: 'var(--text-muted)',
        }}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <p>
            <strong>RuleIndex</strong> — Automated daily semantic distillation of public{' '}
            <code>AGENTS.md</code>, <code>CLAUDE.md</code>, <code>.cursorrules</code>,{' '}
            <code>.windsurfrules</code>, <code>.clinerules</code>, <code>GEMINI.md</code>,{' '}
            <code>SKILL.md</code>, and Copilot instruction files.
          </p>
        </div>
      </footer>

      {/* Mobile Collapsible Slide-Over Filter Drawer (<dialog>) */}
      <dialog
        ref={mobileDrawerRef}
        aria-label="Filter rules"
        onClose={() => setMobileDrawerOpen(false)}
        className="mobile-filter-dialog"
        {...({ closedby: 'any' } as Record<string, string>)}
      >
        <div
          className="flex items-center justify-between border-b px-4 py-3.5"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            Filter Rules
          </span>
          <button
            type="button"
            onClick={() => mobileDrawerRef.current?.close()}
            aria-label="Close filters"
            autoFocus
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border cursor-pointer"
            style={{
              backgroundColor: 'var(--bg-subtle)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-secondary)',
            }}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <FilterPanel
            filters={filters}
            agentCounts={agentCounts}
            categoryCounts={categoryCounts}
            hasActiveFilters={hasActiveFilters}
            onToggleAgent={toggleAgent}
            onClearAgents={clearAgents}
            onToggleCategory={toggleCategory}
            onSetMinAdoption={setMinAdoption}
            onReset={resetFilters}
          />
        </div>

        <div className="border-t p-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            type="button"
            onClick={() => mobileDrawerRef.current?.close()}
            className="min-h-10 w-full rounded-xl px-4 py-2 text-sm font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--accent)', color: '#ffffff' }}
          >
            Show {filteredRules.length} {filteredRules.length === 1 ? 'Rule' : 'Rules'}
          </button>
        </div>
      </dialog>

      {/* Rule Details & Real-World Variations Modal (<dialog>) */}
      <RuleDetailDialog
        rule={selectedRule?.rule ?? null}
        rank={selectedRule?.rank ?? null}
        onClose={() => setSelectedRule(null)}
        onCopyRule={handleCopyRule}
      />

      {/* Share Webpage Modal (<dialog>) */}
      <ShareDialog
        open={shareOpen}
        filters={filters}
        hasActiveFilters={hasActiveFilters}
        onClose={() => setShareOpen(false)}
      />

      {/* Rules File Generator Modal (<dialog>) */}
      <RuleGeneratorDialog
        open={generatorOpen}
        allSortedRules={allSortedRules}
        filteredRules={filteredRules}
        hasActiveFilters={hasActiveFilters}
        activeCategories={filters.categories}
        activeSort={filters.sort}
        initialTopN={urlGeneratorTopN}
        initialIncludeSummaries={urlGeneratorSummaries}
        manualSelectedRules={manualSelectedRules}
        onRemoveManualRule={removeSelectedRule}
        onClearManualRules={clearSelectedRules}
        onCopiedToast={(msg) => setToastMessage(msg)}
        onClose={() => {
          setGeneratorOpen(false);
          setUrlGeneratorTopN(null);
          setUrlGeneratorSummaries(null);
        }}
      />

      {/* Sticky Bottom Selection Bar when rules are hand-picked */}
      {manualSelectedRules.length > 0 && (
        <div
          role="region"
          aria-label="Selected rules actions"
          className="fixed bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2.5 rounded-2xl border px-3.5 py-2 shadow-xl backdrop-blur-md sm:gap-3 sm:px-4"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--bg-surface) 95%, transparent)',
            borderColor: 'var(--accent)',
          }}
        >
          <span className="whitespace-nowrap text-xs font-semibold sm:text-sm" style={{ color: 'var(--text-primary)' }}>
            {manualSelectedRules.length} {manualSelectedRules.length === 1 ? 'rule' : 'rules'} selected
          </span>
          <button
            type="button"
            onClick={clearSelectedRules}
            className="rounded-lg px-2 py-1 text-xs font-medium cursor-pointer hover:underline"
            style={{ color: 'var(--text-muted)' }}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setGeneratorOpen(true)}
            className="inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--accent)', color: '#ffffff' }}
          >
            <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Generate Rules File</span>
          </button>
        </div>
      )}

      {/* Accessible Top-Layer Toast Notifications */}
      <ToastRegion message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </div>
  );
}

export default App;

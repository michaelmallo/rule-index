import { ArrowLeft, BookOpen, Sparkles } from 'lucide-react';
import { marked } from 'marked';
import { useEffect, useMemo } from 'react';
import type { MouseEvent } from 'react';
import readmeMd from '../../../README.md?raw';
import algorithmsMd from '../../../docs/algorithms-and-configuration.md?raw';
import architectureMd from '../../../docs/architecture.md?raw';
import devDeployMd from '../../../docs/development-and-deployment.md?raw';
import userGuideMd from '../../../docs/user-guide.md?raw';
import type { ThemeId } from '../types';
import { ThemeSwitcher } from './ThemeSwitcher';

export interface HelpDocEntry {
  id: string;
  title: string;
  shortTitle: string;
  content: string;
}

export const HELP_DOCS: HelpDocEntry[] = [
  {
    id: 'overview',
    title: 'Overview & Quick Start',
    shortTitle: 'Overview',
    content: readmeMd,
  },
  {
    id: 'user-guide',
    title: 'Web App User Guide',
    shortTitle: 'User Guide',
    content: userGuideMd,
  },
  {
    id: 'architecture',
    title: 'Architecture & Codebase Reference',
    shortTitle: 'Architecture',
    content: architectureMd,
  },
  {
    id: 'algorithms-and-configuration',
    title: 'Algorithms, Scraping & Configuration',
    shortTitle: 'Algorithms & Config',
    content: algorithmsMd,
  },
  {
    id: 'development-and-deployment',
    title: 'Development, Setup & Deployment',
    shortTitle: 'Dev & Deployment',
    content: devDeployMd,
  },
];

const MD_FILE_TO_DOC_ID: Record<string, string> = {
  'readme.md': 'overview',
  'user-guide.md': 'user-guide',
  'architecture.md': 'architecture',
  'algorithms-and-configuration.md': 'algorithms-and-configuration',
  'development-and-deployment.md': 'development-and-deployment',
};

function resolveMarkdownHref(rawHref: string): string {
  if (!rawHref) return rawHref;
  if (/^(https?:|mailto:|sms:|#)/i.test(rawHref)) {
    return rawHref;
  }

  const [pathPart, hashPart] = rawHref.split('#');
  const basename = pathPart.split('/').pop()?.toLowerCase() ?? '';
  const mappedId = MD_FILE_TO_DOC_ID[basename];
  if (mappedId) {
    const base = `${import.meta.env.BASE_URL}?help=${mappedId}`;
    return hashPart ? `${base}#${hashPart}` : base;
  }
  return rawHref;
}

interface HelpPageProps {
  docId: string;
  theme: ThemeId;
  onChangeTheme: (theme: ThemeId) => void;
  onNavigateDoc: (docId: string) => void;
}

export function HelpPage({ docId, theme, onChangeTheme, onNavigateDoc }: HelpPageProps) {
  const activeDoc = useMemo(
    () => HELP_DOCS.find((d) => d.id === docId) ?? HELP_DOCS[0],
    [docId]
  );

  useEffect(() => {
    document.title = `${activeDoc.title} — RuleIndex Help`;
    return () => {
      document.title = 'RuleIndex — AI Coding Agent Rules Leaderboard';
    };
  }, [activeDoc.title]);

  const renderedHtml = useMemo(() => {
    const renderer = new marked.Renderer();
    const defaultLink = renderer.link.bind(renderer);

    renderer.link = (token) => {
      const rewrittenHref = resolveMarkdownHref(token.href);
      // Links inside Help intentionally open in the same browser tab by default (no target="_blank")
      return defaultLink({ ...token, href: rewrittenHref });
    };

    return marked.parse(activeDoc.content, {
      async: false,
      gfm: true,
      breaks: false,
      renderer,
    }) as string;
  }, [activeDoc.content]);

  const handleProseClick = (event: MouseEvent<HTMLDivElement>) => {
    // Allow standard browser behavior for modifier clicks
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    const anchor = target?.closest('a');
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href) return;

    try {
      const url = new URL(href, window.location.href);
      if (url.origin === window.location.origin && url.pathname === window.location.pathname) {
        const nextHelp = url.searchParams.get('help');
        if (nextHelp) {
          event.preventDefault();
          onNavigateDoc(nextHelp);
          if (url.hash) {
            const el = document.getElementById(url.hash.slice(1));
            el?.scrollIntoView();
          } else {
            window.scrollTo({ top: 0, behavior: 'instant' });
          }
        }
      }
    } catch {
      // Let browser handle non-standard URLs normally in the same tab
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Sticky Help Header */}
      <header
        className="sticky top-0 z-30 border-b backdrop-blur-md"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--bg-surface) 90%, transparent)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 py-2.5 sm:px-6 sm:py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <a
              href={import.meta.env.BASE_URL}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl font-bold shadow-sm sm:h-9 sm:w-9"
              style={{ backgroundColor: 'var(--accent)', color: '#ffffff' }}
              aria-label="Back to RuleIndex"
              title="Back to RuleIndex"
            >
              <Sparkles className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
            </a>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="text-sm font-bold tracking-tight sm:text-lg"
                  style={{ color: 'var(--text-primary)' }}
                >
                  RuleIndex Help
                </span>
              </div>
              <a
                href={import.meta.env.BASE_URL}
                className="inline-flex items-center gap-1 text-[11px] font-medium hover:underline sm:text-xs"
                style={{ color: 'var(--accent-text)' }}
              >
                <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                Back to Leaderboard
              </a>
            </div>
          </div>

          <div className="flex shrink-0 items-center">
            <ThemeSwitcher theme={theme} onChange={onChangeTheme} />
          </div>
        </div>
      </header>

      {/* Main Help Layout */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-6 sm:py-6">
        {/* Mobile Doc Selector */}
        <nav aria-label="Help documentation pages" className="mb-4 lg:hidden">
          <div className="flex flex-wrap gap-1.5">
            {HELP_DOCS.map((doc) => {
              const isActive = doc.id === activeDoc.id;
              return (
                <a
                  key={doc.id}
                  href={`${import.meta.env.BASE_URL}?help=${doc.id}`}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                    e.preventDefault();
                    onNavigateDoc(doc.id);
                    window.scrollTo({ top: 0, behavior: 'instant' });
                  }}
                  aria-current={isActive ? 'page' : undefined}
                  className="inline-flex min-h-8 items-center rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors"
                  style={
                    isActive
                      ? {
                          backgroundColor: 'var(--accent-soft)',
                          borderColor: 'var(--accent)',
                          color: 'var(--accent-text)',
                        }
                      : {
                          backgroundColor: 'var(--bg-surface)',
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--text-secondary)',
                        }
                  }
                >
                  {doc.shortTitle}
                </a>
              );
            })}
          </div>
        </nav>

        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          {/* Desktop Sidebar Navigation */}
          <aside
            aria-label="Help documentation pages"
            className="hidden w-64 shrink-0 rounded-2xl border p-4 lg:sticky lg:top-20 lg:block"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Documentation</span>
            </div>
            <ul className="flex flex-col gap-1">
              {HELP_DOCS.map((doc) => {
                const isActive = doc.id === activeDoc.id;
                return (
                  <li key={doc.id}>
                    {isActive ? (
                      <span
                        aria-current="page"
                        className="block rounded-lg px-2.5 py-2 text-sm font-semibold"
                        style={{
                          backgroundColor: 'var(--accent-soft)',
                          color: 'var(--accent-text)',
                        }}
                      >
                        {doc.title}
                      </span>
                    ) : (
                      <a
                        href={`${import.meta.env.BASE_URL}?help=${doc.id}`}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                          e.preventDefault();
                          onNavigateDoc(doc.id);
                          window.scrollTo({ top: 0, behavior: 'instant' });
                        }}
                        className="block rounded-lg px-2.5 py-2 text-sm font-medium transition-colors hover:underline"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {doc.title}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* Rendered Markdown Article */}
          <article
            className="min-w-0 flex-1 rounded-2xl border p-4 sm:p-8"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <div
              className="help-prose"
              onClick={handleProseClick}
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          </article>
        </div>
      </main>
    </div>
  );
}

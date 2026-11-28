import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  FileCode2,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ALL_CATEGORIES, type CanonicalRule, type SortOption } from '../types';
import {
  formatRulesMarkdown,
  mergeSelectedRules,
  selectTopRulesPerCategory,
} from '../utils/ruleGenerator';

type SelectionMode = 'top-n' | 'manual' | 'combined';

const PRESET_COUNTS = [3, 5, 10] as const;
const MIN_PER_CATEGORY = 1;
const MAX_PER_CATEGORY = 25;

interface RuleGeneratorDialogProps {
  open: boolean;
  allSortedRules: readonly CanonicalRule[];
  filteredRules: readonly CanonicalRule[];
  hasActiveFilters: boolean;
  activeCategories: readonly string[];
  activeSort: SortOption;
  manualSelectedRules: readonly CanonicalRule[];
  onRemoveManualRule: (ruleId: string) => void;
  onClearManualRules: () => void;
  onCopiedToast: (message: string) => void;
  onClose: () => void;
}

const SORT_LABELS: Record<SortOption, string> = {
  repos: 'Most Repos',
  weighted: 'Star-Weighted',
  trending: 'Trending / Recent',
};

export function RuleGeneratorDialog({
  open,
  allSortedRules,
  filteredRules,
  hasActiveFilters,
  activeCategories,
  activeSort,
  manualSelectedRules,
  onRemoveManualRule,
  onClearManualRules,
  onCopiedToast,
  onClose,
}: RuleGeneratorDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const countInputId = useId();

  const [step, setStep] = useState<'configure' | 'preview'>('configure');
  const [mode, setMode] = useState<SelectionMode>('top-n');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([...ALL_CATEGORIES]);
  const [perCategoryCount, setPerCategoryCount] = useState<number>(5);
  const [useFilteredPool, setUseFilteredPool] = useState<boolean>(false);
  const [includeSummaries, setIncludeSummaries] = useState<boolean>(true);
  const [isCopied, setIsCopied] = useState<boolean>(false);

  // Initialize sensible defaults each time the modal opens
  useEffect(() => {
    if (!open) return;
    setStep('configure');
    setIsCopied(false);
    setMode(manualSelectedRules.length > 0 ? 'manual' : 'top-n');
    setSelectedCategories(
      activeCategories.length > 0 ? [...activeCategories] : [...ALL_CATEGORIES]
    );
    setUseFilteredPool(hasActiveFilters);
  }, [open, activeCategories, hasActiveFilters, manualSelectedRules.length]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Light-dismiss fallback for browsers without native <dialog closedby="any">
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;

    const isOutside = (e: PointerEvent) => {
      const rect = dialog.getBoundingClientRect();
      return (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      );
    };

    let pressedOutside = false;
    const onPointerDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) {
        dialog.close();
      }
      pressedOutside = false;
    };

    dialog.addEventListener('pointerdown', onPointerDown);
    dialog.addEventListener('pointerup', onPointerUp);
    return () => {
      dialog.removeEventListener('pointerdown', onPointerDown);
      dialog.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  const rulePool = useFilteredPool && hasActiveFilters ? filteredRules : allSortedRules;

  const topNRules = useMemo(() => {
    if (!open || mode === 'manual') return [];
    return selectTopRulesPerCategory(rulePool, selectedCategories, perCategoryCount);
  }, [open, mode, rulePool, selectedCategories, perCategoryCount]);

  const finalRules = useMemo(() => {
    if (!open) return [];
    if (mode === 'manual') {
      return mergeSelectedRules(manualSelectedRules, []);
    }
    if (mode === 'top-n') {
      return topNRules;
    }
    return mergeSelectedRules(manualSelectedRules, topNRules);
  }, [open, mode, manualSelectedRules, topNRules]);

  const categorySummaryCount = useMemo(() => {
    const cats = new Set<string>();
    for (const rule of finalRules) {
      cats.add(rule.category);
    }
    return cats.size;
  }, [finalRules]);

  const generatedMarkdown = useMemo(() => {
    if (step !== 'preview' || finalRules.length === 0) return '';
    return formatRulesMarkdown(finalRules, { includeSummaries });
  }, [step, finalRules, includeSummaries]);

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleCountChange = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      setPerCategoryCount(MIN_PER_CATEGORY);
      return;
    }
    setPerCategoryCount(Math.max(MIN_PER_CATEGORY, Math.min(MAX_PER_CATEGORY, parsed)));
  };

  const handleClose = () => {
    const dialog = dialogRef.current;
    if (dialog) {
      dialog.returnValue = '';
    }
    setIsCopied(false);
    onClose();
  };

  const handleCopyMarkdown = () => {
    if (!generatedMarkdown) return;
    const markSuccess = () => {
      setIsCopied(true);
      onCopiedToast('Copied generated rules file to clipboard');
      window.setTimeout(() => setIsCopied(false), 2000);
    };

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(generatedMarkdown).then(markSuccess).catch(() => {
        onCopiedToast('Could not access clipboard');
      });
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = generatedMarkdown;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      markSuccess();
    }
  };

  const handleDownloadMarkdown = () => {
    if (!generatedMarkdown) return;
    const blob = new Blob([generatedMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'AGENTS.md';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={handleClose}
      className="rule-generator-dialog"
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      {open && (
        <>
          {/* Modal Header */}
          <div
            className="flex items-center justify-between gap-4 border-b px-5 py-4 sm:px-6"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <FileCode2 className="h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true" />
              <h1
                id={titleId}
                className="truncate text-base font-bold sm:text-lg"
                style={{ color: 'var(--text-primary)' }}
              >
                {step === 'configure' ? 'Generate Rules File' : 'Generated Rules File'}
              </h1>
            </div>

            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close rules file generator"
              autoFocus
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors cursor-pointer"
              style={{
                borderColor: 'var(--border-subtle)',
                backgroundColor: 'var(--bg-subtle)',
                color: 'var(--text-secondary)',
              }}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {/* Modal Body */}
          {step === 'configure' ? (
            <>
              <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5 sm:px-6">
                {/* Selection Mode Tabs */}
                <div>
                  <span
                    className="mb-2 block text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Selection Source
                  </span>
                  <div
                    role="group"
                    aria-label="Rule selection mode"
                    className="grid grid-cols-1 gap-1.5 rounded-xl border p-1 sm:grid-cols-3"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      borderColor: 'var(--border-subtle)',
                    }}
                  >
                    {(
                      [
                        { id: 'top-n', label: 'Top N per Category' },
                        {
                          id: 'manual',
                          label: `Hand-Picked (${manualSelectedRules.length})`,
                        },
                        {
                          id: 'combined',
                          label: 'Combine Both',
                        },
                      ] as const
                    ).map((opt) => {
                      const active = mode === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setMode(opt.id)}
                          aria-pressed={active}
                          className="min-h-9 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
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
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Top N per Category Configuration */}
                {(mode === 'top-n' || mode === 'combined') && (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <label
                        htmlFor={countInputId}
                        className="text-sm font-semibold"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        Top rules per category
                      </label>
                      <div className="flex items-center gap-1.5">
                        {PRESET_COUNTS.map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setPerCategoryCount(n)}
                            aria-pressed={perCategoryCount === n}
                            className="min-h-8 min-w-9 rounded-lg border px-2.5 text-xs font-semibold transition-colors cursor-pointer"
                            style={
                              perCategoryCount === n
                                ? {
                                    backgroundColor: 'var(--accent-soft)',
                                    borderColor: 'var(--accent)',
                                    color: 'var(--accent-text)',
                                  }
                                : {
                                    backgroundColor: 'var(--bg-subtle)',
                                    borderColor: 'var(--border-subtle)',
                                    color: 'var(--text-secondary)',
                                  }
                            }
                          >
                            {n}
                          </button>
                        ))}
                        <input
                          id={countInputId}
                          type="number"
                          min={MIN_PER_CATEGORY}
                          max={MAX_PER_CATEGORY}
                          value={perCategoryCount}
                          onChange={(e) => handleCountChange(e.target.value)}
                          aria-label="Custom number of top rules per category"
                          className="h-8 w-16 rounded-lg border px-2 text-center text-xs font-semibold tabular-nums"
                          style={{
                            backgroundColor: 'var(--bg-subtle)',
                            borderColor: 'var(--border-strong)',
                            color: 'var(--text-primary)',
                          }}
                        />
                      </div>
                    </div>

                    {/* Category Multi-Select */}
                    <fieldset className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <legend className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          Categories to include
                        </legend>
                        <div className="flex items-center gap-3 text-xs font-medium">
                          <button
                            type="button"
                            onClick={() => setSelectedCategories([...ALL_CATEGORIES])}
                            className="cursor-pointer hover:underline"
                            style={{ color: 'var(--accent-text)' }}
                          >
                            Select all
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedCategories([])}
                            className="cursor-pointer hover:underline"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            Clear
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {ALL_CATEGORIES.map((cat) => {
                          const checked = selectedCategories.includes(cat);
                          return (
                            <label
                              key={cat}
                              className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm"
                              style={
                                checked
                                  ? {
                                      backgroundColor: 'var(--accent-soft)',
                                      borderColor: 'var(--accent)',
                                      color: 'var(--accent-text)',
                                    }
                                  : {
                                      backgroundColor: 'var(--bg-subtle)',
                                      borderColor: 'var(--border-subtle)',
                                      color: 'var(--text-secondary)',
                                    }
                              }
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleCategory(cat)}
                                className="h-4 w-4 rounded accent-[var(--accent)]"
                              />
                              <span className="leading-snug">{cat}</span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>

                    {/* Active Filter & Sort Context */}
                    <div
                      className="flex flex-col gap-2 rounded-xl border p-3 text-xs"
                      style={{
                        backgroundColor: 'var(--bg-subtle)',
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <span>
                        Ranked by <strong style={{ color: 'var(--text-primary)' }}>{SORT_LABELS[activeSort]}</strong>
                      </span>
                      {hasActiveFilters && (
                        <label className="inline-flex cursor-pointer items-center gap-2 font-medium">
                          <input
                            type="checkbox"
                            checked={useFilteredPool}
                            onChange={(e) => setUseFilteredPool(e.target.checked)}
                            className="h-4 w-4 rounded accent-[var(--accent)]"
                          />
                          <span>
                            Restrict to currently filtered leaderboard ({filteredRules.length.toLocaleString()} matching rules)
                          </span>
                        </label>
                      )}
                    </div>
                  </div>
                )}

                {/* Hand-Picked Rules Section */}
                {(mode === 'manual' || mode === 'combined') && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        Hand-Picked Rules ({manualSelectedRules.length})
                      </h2>
                      {manualSelectedRules.length > 0 && (
                        <button
                          type="button"
                          onClick={onClearManualRules}
                          className="inline-flex items-center gap-1 text-xs font-medium cursor-pointer hover:underline"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Clear selected
                        </button>
                      )}
                    </div>

                    {manualSelectedRules.length === 0 ? (
                      <p
                        className="rounded-xl border p-3.5 text-xs leading-relaxed"
                        style={{
                          backgroundColor: 'var(--bg-subtle)',
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--text-muted)',
                        }}
                      >
                        No individual rules selected yet. Close this dialog and click <strong>Select</strong> on any
                        rule card in the leaderboard, or switch to <strong>Top N per Category</strong> above.
                      </p>
                    ) : (
                      <ul
                        className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-xl border p-2"
                        style={{
                          backgroundColor: 'var(--bg-subtle)',
                          borderColor: 'var(--border-subtle)',
                        }}
                      >
                        {manualSelectedRules.map((rule) => (
                          <li
                            key={rule.id}
                            className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
                            style={{
                              backgroundColor: 'var(--bg-surface)',
                              borderColor: 'var(--border-subtle)',
                            }}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {rule.title}
                              </p>
                              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                {rule.category}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => onRemoveManualRule(rule.id)}
                              aria-label={`Remove ${rule.title}`}
                              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md cursor-pointer"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Formatting Option */}
                <label
                  className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium sm:text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <input
                    type="checkbox"
                    checked={includeSummaries}
                    onChange={(e) => setIncludeSummaries(e.target.checked)}
                    className="h-4 w-4 rounded accent-[var(--accent)]"
                  />
                  <span>Include rule summaries alongside titles</span>
                </label>
              </div>

              {/* Configure Footer */}
              <div
                className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3.5 sm:px-6"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  {finalRules.length > 0 ? (
                    <>
                      Will generate{' '}
                      <strong style={{ color: 'var(--text-primary)' }}>{finalRules.length}</strong>{' '}
                      {finalRules.length === 1 ? 'rule' : 'rules'} across{' '}
                      <strong style={{ color: 'var(--text-primary)' }}>{categorySummaryCount}</strong>{' '}
                      {categorySummaryCount === 1 ? 'category' : 'categories'}
                    </>
                  ) : (
                    'Select at least one rule or category to generate'
                  )}
                </span>

                <button
                  type="button"
                  disabled={finalRules.length === 0}
                  onClick={() => {
                    setIsCopied(false);
                    setStep('preview');
                  }}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-opacity cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
                  style={{ backgroundColor: 'var(--accent)', color: '#ffffff' }}
                >
                  <FileCode2 className="h-4 w-4" aria-hidden="true" />
                  <span>Generate Rules File</span>
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Generated Markdown Preview */}
              <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span style={{ color: 'var(--text-muted)' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>{finalRules.length}</strong> rules across{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>{categorySummaryCount}</strong>{' '}
                    {categorySummaryCount === 1 ? 'category' : 'categories'} — paste into{' '}
                    <code>AGENTS.md</code>, <code>CLAUDE.md</code>, or <code>.cursorrules</code>
                  </span>

                  <label
                    className="inline-flex cursor-pointer items-center gap-1.5 font-medium"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <input
                      type="checkbox"
                      checked={includeSummaries}
                      onChange={(e) => setIncludeSummaries(e.target.checked)}
                      className="h-3.5 w-3.5 rounded accent-[var(--accent)]"
                    />
                    <span>Include summaries</span>
                  </label>
                </div>

                <textarea
                  readOnly
                  value={generatedMarkdown}
                  aria-label="Generated Markdown rules file"
                  rows={16}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-h-64 w-full flex-1 resize-y rounded-xl border p-3.5 text-xs leading-relaxed sm:text-[13px]"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
              </div>

              {/* Preview Footer Actions */}
              <div
                className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3.5 sm:px-6"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <button
                  type="button"
                  onClick={() => setStep('configure')}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold cursor-pointer"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Edit Selection</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadMarkdown}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold cursor-pointer"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      borderColor: 'var(--border-strong)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Download .md</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyMarkdown}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-semibold cursor-pointer"
                    style={{ backgroundColor: 'var(--accent)', color: '#ffffff' }}
                  >
                    {isCopied ? (
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    <span>{isCopied ? 'Copied!' : 'Copy to Clipboard'}</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </dialog>
  );
}

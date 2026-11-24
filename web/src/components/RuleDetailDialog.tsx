import { Calendar, Check, Copy, ExternalLink, GitBranch, Star, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { CanonicalRule } from '../types';

interface RuleDetailDialogProps {
  rule: CanonicalRule | null;
  rank: number | null;
  onClose: () => void;
  onCopyRule: (rule: CanonicalRule) => void;
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function RuleDetailDialog({ rule, rank, onClose, onCopyRule }: RuleDetailDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [copiedLocal, setCopiedLocal] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (rule && !dialog.open) {
      dialog.showModal();
    } else if (!rule && dialog.open) {
      dialog.close();
    }
  }, [rule]);

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

  const handleClose = () => {
    const dialog = dialogRef.current;
    if (dialog) {
      dialog.returnValue = '';
    }
    setCopiedLocal(false);
    onClose();
  };

  const handleCopy = () => {
    if (!rule) return;
    onCopyRule(rule);
    setCopiedLocal(true);
    window.setTimeout(() => setCopiedLocal(false), 1800);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={handleClose}
      className="rule-detail-dialog"
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      {rule && (
        <>
          <div
            className="flex items-start justify-between gap-4 border-b px-5 py-4 sm:px-6"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {rank !== null && (
                  <span
                    className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold tabular-nums"
                    style={{ backgroundColor: 'var(--rank-bg)', color: 'var(--rank-text)' }}
                  >
                    #{rank}
                  </span>
                )}
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}
                >
                  {rule.category}
                </span>
              </div>
              <h1 id={titleId} className="text-lg font-bold leading-snug sm:text-xl" style={{ color: 'var(--text-primary)' }}>
                {rule.title}
              </h1>
            </div>

            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close rule details"
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

          <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            <p className="text-sm leading-relaxed sm:text-base" style={{ color: 'var(--text-secondary)' }}>
              {rule.summary}
            </p>

            {/* Quick Stats + Copy Action */}
            <div
              className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-subtle)',
              }}
            >
              <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm">
                <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: 'var(--text-primary)' }}>
                  <GitBranch className="h-4 w-4" style={{ color: 'var(--accent)' }} aria-hidden="true" />
                  {rule.adoption_count.toLocaleString()} repos
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: 'var(--text-secondary)' }}>
                  <Star className="h-4 w-4" style={{ color: 'var(--accent)' }} aria-hidden="true" />
                  Score {rule.weighted_score.toFixed(1)}
                </span>
                <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                  First seen {formatDate(rule.first_seen)}
                </span>
              </div>

              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: '#ffffff',
                }}
              >
                {copiedLocal ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                {copiedLocal ? 'Copied Markdown' : 'Copy Markdown Rule'}
              </button>
            </div>

            {/* Target Agents */}
            <div className="mt-5">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Observed Across Agents
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {rule.agents.map((agent) => (
                  <span
                    key={agent}
                    className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium"
                    style={{
                      backgroundColor: 'var(--badge-bg)',
                      borderColor: 'var(--border-subtle)',
                      color: 'var(--badge-text)',
                    }}
                  >
                    {agent}
                  </span>
                ))}
              </div>
            </div>

            {/* Real-World Verbatim Variations */}
            <div className="mt-6">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Real-World Phrasing Variations ({rule.examples.length})
              </h2>
              <div className="flex flex-col gap-3">
                {rule.examples.map((ex, idx) => (
                  <div
                    key={`${ex.repo}-${idx}`}
                    className="rounded-xl border p-3.5"
                    style={{
                      backgroundColor: 'var(--bg-elevated)',
                      borderColor: 'var(--border-subtle)',
                    }}
                  >
                    <blockquote
                      className="text-sm leading-relaxed"
                      style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                    >
                      “{ex.text}”
                    </blockquote>
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <a
                          href={ex.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium hover:underline"
                          style={{ color: 'var(--accent-text)' }}
                        >
                          <span>{ex.repo}</span>
                          <span style={{ color: 'var(--text-muted)' }}>/ {ex.file_path}</span>
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      </div>
                      <div className="flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                        <span
                          className="rounded px-1.5 py-0.5 text-[11px] font-medium"
                          style={{ backgroundColor: 'var(--badge-bg)', color: 'var(--badge-text)' }}
                        >
                          {ex.agent}
                        </span>
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <Star className="h-3 w-3" aria-hidden="true" />
                          {ex.stars.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}

import {
  Check,
  Copy,
  Link2,
  Mail,
  MessageCircle,
  MessageSquare,
  Send,
  Share2,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FilterState } from '../types';

interface ShareDialogProps {
  open: boolean;
  filters: FilterState;
  hasActiveFilters: boolean;
  onClose: () => void;
}

function buildShareUrl(filters: FilterState, includeFilters: boolean): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';

  if (includeFilters) {
    if (filters.query.trim()) url.searchParams.set('q', filters.query.trim());
    if (filters.agents.length > 0) url.searchParams.set('agents', filters.agents.join(','));
    if (filters.categories.length > 0) url.searchParams.set('categories', filters.categories.join(','));
    if (filters.minAdoption > 0) url.searchParams.set('min', String(filters.minAdoption));
    if (filters.sort !== 'repos') url.searchParams.set('sort', filters.sort);
  }

  return url.toString();
}

export function ShareDialog({ open, filters, hasActiveFilters, onClose }: ShareDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const linkInputId = useId();
  const [includeFilters, setIncludeFilters] = useState(hasActiveFilters);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setIncludeFilters(hasActiveFilters);
    }
  }, [open, hasActiveFilters]);

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

  const shareUrl = useMemo(
    () => buildShareUrl(filters, includeFilters),
    [filters, includeFilters]
  );

  const shareTitle = 'RuleIndex — AI Coding Agent Rules Leaderboard';
  const shareText =
    'Explore the top AI coding agent rules distilled daily from public GitHub repositories on RuleIndex:';

  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedTitle = encodeURIComponent(shareTitle);
  const encodedText = encodeURIComponent(shareText);
  const encodedTextWithUrl = encodeURIComponent(`${shareText} ${shareUrl}`);

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const shareOptions = [
    {
      name: 'X (Twitter)',
      href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
      badge: '𝕏',
      external: true,
    },
    {
      name: 'LinkedIn',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
      badge: 'in',
      external: true,
    },
    {
      name: 'Reddit',
      href: `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedTitle}`,
      badge: 'r/',
      external: true,
    },
    {
      name: 'Hacker News',
      href: `https://news.ycombinator.com/submitlink?u=${encodedUrl}&t=${encodedTitle}`,
      badge: 'Y',
      external: true,
    },
    {
      name: 'Bluesky',
      href: `https://bsky.app/intent/compose?text=${encodedTextWithUrl}`,
      badge: '🦋',
      external: true,
    },
    {
      name: 'WhatsApp',
      href: `https://wa.me/?text=${encodedTextWithUrl}`,
      icon: MessageCircle,
      external: true,
    },
    {
      name: 'Telegram',
      href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
      icon: Send,
      external: true,
    },
    {
      name: 'Email',
      href: `mailto:?subject=${encodedTitle}&body=${encodeURIComponent(`${shareText}\n\n${shareUrl}`)}`,
      icon: Mail,
      external: false,
    },
    {
      name: 'Text / SMS',
      href: `sms:?&body=${encodedTextWithUrl}`,
      icon: MessageSquare,
      external: false,
    },
  ];

  const handleClose = () => {
    const dialog = dialogRef.current;
    if (dialog) {
      dialog.returnValue = '';
    }
    setCopied(false);
    onClose();
  };

  const handleCopyLink = () => {
    const markCopied = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    };

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(shareUrl).then(markCopied).catch(() => {});
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = shareUrl;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      markCopied();
    }
  };

  const handleNativeShare = () => {
    if (!canNativeShare) return;
    navigator.share({ title: shareTitle, text: shareText, url: shareUrl }).catch(() => {
      // User cancelled native share sheet
    });
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={handleClose}
      className="share-dialog"
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      {open && (
        <>
          <div
            className="flex items-center justify-between gap-4 border-b px-5 py-4"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <div className="flex items-center gap-2">
              <Share2 className="h-4 w-4" style={{ color: 'var(--accent)' }} aria-hidden="true" />
              <h1 id={titleId} className="text-base font-bold sm:text-lg" style={{ color: 'var(--text-primary)' }}>
                Share RuleIndex
              </h1>
            </div>

            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close share dialog"
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

          <div className="flex flex-col gap-5 overflow-y-auto px-5 py-5">
            {/* Shareable Link Builder */}
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor={linkInputId}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Shareable Link
                </label>

                {hasActiveFilters && (
                  <label
                    className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <input
                      type="checkbox"
                      checked={includeFilters}
                      onChange={(e) => setIncludeFilters(e.target.checked)}
                      className="h-3.5 w-3.5 rounded accent-[var(--accent)]"
                    />
                    Include active filters
                  </label>
                )}
              </div>

              <div className="flex items-stretch gap-2">
                <input
                  id={linkInputId}
                  type="text"
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-h-10 min-w-0 flex-1 rounded-xl border px-3 text-xs sm:text-sm"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold transition-colors cursor-pointer"
                  style={{
                    backgroundColor: 'var(--accent)',
                    color: '#ffffff',
                  }}
                >
                  {copied ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span>{copied ? 'Copied!' : 'Copy Link'}</span>
                </button>
              </div>
            </div>

            {/* Social Media, Email & Messaging Options */}
            <div>
              <h2
                className="mb-2.5 text-xs font-semibold uppercase tracking-wider"
                style={{ color: 'var(--text-muted)' }}
              >
                Share via Social, Email, or Text
              </h2>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {shareOptions.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <a
                      key={opt.name}
                      href={opt.href}
                      target={opt.external ? '_blank' : undefined}
                      rel={opt.external ? 'noopener noreferrer' : undefined}
                      className="flex min-h-11 items-center gap-2.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors sm:text-sm"
                      style={{
                        backgroundColor: 'var(--bg-elevated)',
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <span
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                        style={{
                          backgroundColor: 'var(--accent-soft)',
                          color: 'var(--accent-text)',
                        }}
                        aria-hidden="true"
                      >
                        {Icon ? <Icon className="h-4 w-4" /> : opt.badge}
                      </span>
                      <span className="truncate">{opt.name}</span>
                    </a>
                  );
                })}
              </div>
            </div>

            {canNativeShare && (
              <button
                type="button"
                onClick={handleNativeShare}
                className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold transition-colors cursor-pointer sm:text-sm"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-strong)',
                  color: 'var(--text-primary)',
                }}
              >
                <Share2 className="h-4 w-4" aria-hidden="true" />
                <span>More Device Share Options</span>
              </button>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}

import { CheckCircle2, X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';

interface ToastRegionProps {
  message: string | null;
  onDismiss: () => void;
}

export function ToastRegion({ message, onDismiss }: ToastRegionProps) {
  const toastId = useId();
  const popoverRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const focusedInsideRef = useRef(false);

  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (message) {
      if (typeof el.showPopover === 'function') {
        try {
          if (!el.matches(':popover-open')) {
            el.showPopover();
          }
        } catch {
          // Ignore if already open or unsupported
        }
      }

      // Announce via native ariaNotify() when supported; fallback is the aria-live region below
      const docWithNotify = document as Document & { ariaNotify?: (msg: string) => void };
      if (typeof docWithNotify.ariaNotify === 'function') {
        docWithNotify.ariaNotify(message);
      }

      timerRef.current = window.setTimeout(() => {
        if (!focusedInsideRef.current) {
          onDismiss();
        }
      }, 3200);
    } else if (typeof el.hidePopover === 'function') {
      try {
        if (el.matches(':popover-open')) {
          el.hidePopover();
        }
      } catch {
        // Ignore if already hidden
      }
    }

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [message, onDismiss]);

  return (
    <div role="region" aria-label="Notifications">
      {/* Screen-reader fallback live region for browsers without ariaNotify() */}
      <p className="sr-only-live">Screen reader notifications</p>
      <div className="sr-only-live" aria-live="polite" aria-atomic="true">
        {message ?? ''}
      </div>

      <div
        id={toastId}
        ref={popoverRef}
        className="rule-toast"
        {...({ popover: 'manual' } as Record<string, string>)}
        onFocus={() => {
          focusedInsideRef.current = true;
        }}
        onBlur={() => {
          focusedInsideRef.current = false;
        }}
      >
        {message && (
          <div
            className="flex max-w-sm items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium shadow-xl"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--accent)',
              color: 'var(--text-primary)',
            }}
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true" />
            <span className="flex-1">{message}</span>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss notification"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
              {...({ popovertarget: toastId, popovertargetaction: 'hide' } as Record<string, string>)}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

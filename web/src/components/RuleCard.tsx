import { Check, Copy, GitBranch, MessageSquareQuote, Star } from 'lucide-react';
import { memo } from 'react';
import type { CanonicalRule } from '../types';

interface RuleCardProps {
  rule: CanonicalRule;
  rank: number;
  isCopied: boolean;
  isDeferred: boolean;
  selectedAgents: readonly string[];
  onToggleAgent: (agent: string) => void;
  onCopyRule: (rule: CanonicalRule) => void;
  onSelectRule: (rule: CanonicalRule, rank: number) => void;
}

export const RuleCard = memo(function RuleCard({
  rule,
  rank,
  isCopied,
  isDeferred,
  selectedAgents,
  onToggleAgent,
  onCopyRule,
  onSelectRule,
}: RuleCardProps) {
  return (
    <li
      className={`${isDeferred ? 'rule-card-deferred ' : ''}rounded-xl border p-3 transition-colors sm:rounded-2xl sm:p-5`}
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        {/* Rank + Main Rule Info */}
        <div className="flex items-start gap-2.5 min-w-0 flex-1 sm:gap-3.5">
          <span
            className="mt-0.5 inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-lg px-1.5 text-[11px] font-bold tabular-nums sm:h-8 sm:min-w-8 sm:px-2 sm:text-xs"
            style={{
              backgroundColor: rank <= 3 ? 'var(--rank-bg)' : 'var(--bg-subtle)',
              color: rank <= 3 ? 'var(--rank-text)' : 'var(--text-primary)',
            }}
            aria-label={`Rank ${rank}`}
          >
            #{rank}
          </span>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-1.5 sm:mb-1.5 sm:gap-2">
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold sm:px-2.5 sm:text-[11px]"
                style={{
                  backgroundColor: 'var(--accent-soft)',
                  color: 'var(--accent-text)',
                }}
              >
                {rule.category}
              </span>
              <span
                className="inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums sm:text-xs"
                style={{ color: 'var(--text-secondary)' }}
              >
                <GitBranch className="h-3 w-3 sm:h-3.5 sm:w-3.5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
                {rule.adoption_count.toLocaleString()} repos
              </span>
              <span
                className="inline-flex items-center gap-1 text-[11px] tabular-nums sm:text-xs"
                style={{ color: 'var(--text-muted)' }}
              >
                <Star className="h-3 w-3" aria-hidden="true" />
                {rule.weighted_score.toFixed(1)}
              </span>
            </div>

            <h2
              className="text-sm font-bold leading-snug sm:text-[17px]"
              style={{ color: 'var(--text-primary)' }}
            >
              {rule.title}
            </h2>

            <p className="mt-1 text-xs leading-relaxed sm:text-sm" style={{ color: 'var(--text-secondary)' }}>
              {rule.summary}
            </p>

            {/* Target Agent Badges */}
            <div className="mt-2 flex flex-wrap items-center gap-1 sm:mt-3 sm:gap-1.5">
              {rule.agents.map((agent) => (
                <button
                  key={agent}
                  type="button"
                  onClick={() => onToggleAgent(agent)}
                  title={`Filter by ${agent}`}
                  className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors cursor-pointer sm:px-2 sm:text-[11px]"
                  style={
                    selectedAgents.includes(agent)
                      ? {
                          backgroundColor: 'var(--accent-soft)',
                          borderColor: 'var(--accent)',
                          color: 'var(--accent-text)',
                        }
                      : {
                          backgroundColor: 'var(--badge-bg)',
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--badge-text)',
                        }
                  }
                >
                  {agent}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-stretch">
          <button
            type="button"
            onClick={() => onCopyRule(rule)}
            className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer sm:flex-initial"
            style={
              isCopied
                ? {
                    backgroundColor: 'var(--accent)',
                    borderColor: 'var(--accent)',
                    color: '#ffffff',
                  }
                : {
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }
            }
          >
            {isCopied ? (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{isCopied ? 'Copied' : 'Copy Rule'}</span>
          </button>

          <button
            type="button"
            onClick={() => onSelectRule(rule, rank)}
            className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer sm:flex-initial"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-strong)',
              color: 'var(--text-secondary)',
            }}
          >
            <MessageSquareQuote className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Examples ({rule.examples.length})</span>
          </button>
        </div>
      </div>
    </li>
  );
});

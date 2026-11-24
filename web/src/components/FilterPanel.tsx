import { RotateCcw } from 'lucide-react';
import {
  AGENT_LABELS,
  ALL_AGENTS,
  ALL_CATEGORIES,
  MIN_ADOPTION_OPTIONS,
  type FilterState,
  type MinAdoption,
} from '../types';

interface FilterPanelProps {
  filters: FilterState;
  agentCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  hasActiveFilters: boolean;
  onToggleAgent: (agent: string) => void;
  onClearAgents: () => void;
  onToggleCategory: (category: string) => void;
  onSetMinAdoption: (min: MinAdoption) => void;
  onReset: () => void;
}

export function FilterPanel({
  filters,
  agentCounts,
  categoryCounts,
  hasActiveFilters,
  onToggleAgent,
  onClearAgents,
  onToggleCategory,
  onSetMinAdoption,
  onReset,
}: FilterPanelProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Filters
        </h2>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 text-xs font-medium cursor-pointer hover:underline"
            style={{ color: 'var(--accent-text)' }}
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Reset all
          </button>
        )}
      </div>

      {/* Minimum Adoption */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Minimum Adoption
        </legend>
        <div className="grid grid-cols-2 gap-1.5">
          {MIN_ADOPTION_OPTIONS.map((opt) => {
            const active = filters.minAdoption === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onSetMinAdoption(opt.value)}
                aria-pressed={active}
                className="min-h-9 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer"
                style={
                  active
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
                {opt.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Target Agent / System Multi-Select */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Target Agent / System
        </legend>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={onClearAgents}
            aria-pressed={filters.agents.length === 0}
            className="flex min-h-9 items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors cursor-pointer"
            style={
              filters.agents.length === 0
                ? {
                    backgroundColor: 'var(--accent-soft)',
                    color: 'var(--accent-text)',
                    fontWeight: 600,
                  }
                : { color: 'var(--text-secondary)' }
            }
          >
            <span>All Agents</span>
          </button>

          {ALL_AGENTS.map((agent) => {
            const selected = filters.agents.includes(agent);
            const count = agentCounts[agent] ?? 0;
            return (
              <label
                key={agent}
                className="flex min-h-9 cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors"
                style={
                  selected
                    ? {
                        backgroundColor: 'var(--accent-soft)',
                        color: 'var(--accent-text)',
                        fontWeight: 600,
                      }
                    : { color: 'var(--text-secondary)' }
                }
              >
                <span className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleAgent(agent)}
                    className="h-4 w-4 rounded accent-[var(--accent)]"
                  />
                  <span>{AGENT_LABELS[agent] ?? agent}</span>
                </span>
                <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {count}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Rule Category Multi-Select */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Rule Category
        </legend>
        <div className="flex flex-col gap-1">
          {ALL_CATEGORIES.map((category) => {
            const selected = filters.categories.includes(category);
            const count = categoryCounts[category] ?? 0;
            return (
              <label
                key={category}
                className="flex min-h-9 cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors"
                style={
                  selected
                    ? {
                        backgroundColor: 'var(--accent-soft)',
                        color: 'var(--accent-text)',
                        fontWeight: 600,
                      }
                    : { color: 'var(--text-secondary)' }
                }
              >
                <span className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleCategory(category)}
                    className="h-4 w-4 rounded accent-[var(--accent)]"
                  />
                  <span className="leading-snug">{category}</span>
                </span>
                <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {count}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

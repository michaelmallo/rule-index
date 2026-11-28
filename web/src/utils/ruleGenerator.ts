import { ALL_CATEGORIES, type CanonicalRule } from '../types';

export interface FormatRulesOptions {
  includeSummaries: boolean;
}

/**
 * Select up to `perCategoryCount` rules for each requested category from an
 * already-sorted rule list in a single linear pass, exiting early once every
 * selected category is filled.
 */
export function selectTopRulesPerCategory(
  sortedRules: readonly CanonicalRule[],
  selectedCategories: readonly string[],
  perCategoryCount: number
): CanonicalRule[] {
  if (perCategoryCount <= 0 || selectedCategories.length === 0) {
    return [];
  }

  const categorySet = new Set(selectedCategories);
  const buckets = new Map<string, CanonicalRule[]>();
  for (const cat of selectedCategories) {
    buckets.set(cat, []);
  }

  let filledCategories = 0;
  const targetCategories = categorySet.size;

  for (const rule of sortedRules) {
    if (!categorySet.has(rule.category)) continue;
    const bucket = buckets.get(rule.category);
    if (!bucket || bucket.length >= perCategoryCount) continue;

    bucket.push(rule);
    if (bucket.length === perCategoryCount) {
      filledCategories += 1;
      if (filledCategories >= targetCategories) {
        break;
      }
    }
  }

  const ordered: CanonicalRule[] = [];
  for (const cat of ALL_CATEGORIES) {
    const bucket = buckets.get(cat);
    if (bucket && bucket.length > 0) {
      ordered.push(...bucket);
    }
  }
  return ordered;
}

/**
 * Combine manually hand-picked rules and top-N-per-category rules into a
 * deduplicated list grouped in canonical category order.
 */
export function mergeSelectedRules(
  manualRules: readonly CanonicalRule[],
  topPerCategoryRules: readonly CanonicalRule[]
): CanonicalRule[] {
  const seen = new Set<string>();
  const byCategory = new Map<string, CanonicalRule[]>();

  const pushUnique = (rule: CanonicalRule) => {
    if (seen.has(rule.id)) return;
    seen.add(rule.id);
    const list = byCategory.get(rule.category) ?? [];
    list.push(rule);
    byCategory.set(rule.category, list);
  };

  for (const rule of manualRules) {
    pushUnique(rule);
  }
  for (const rule of topPerCategoryRules) {
    pushUnique(rule);
  }

  const ordered: CanonicalRule[] = [];
  for (const cat of ALL_CATEGORIES) {
    const list = byCategory.get(cat);
    if (list && list.length > 0) {
      ordered.push(...list);
    }
  }
  // Include any rule whose category isn't in ALL_CATEGORIES (defensive fallback)
  for (const [cat, list] of byCategory.entries()) {
    if (!(ALL_CATEGORIES as readonly string[]).includes(cat)) {
      ordered.push(...list);
    }
  }
  return ordered;
}

/**
 * Format a list of canonical rules into a clean, generic Markdown rules file
 * ready to paste into AGENTS.md, CLAUDE.md, .cursorrules, etc.
 */
export function formatRulesMarkdown(
  rules: readonly CanonicalRule[],
  options: FormatRulesOptions
): string {
  const byCategory = new Map<string, CanonicalRule[]>();
  for (const rule of rules) {
    const list = byCategory.get(rule.category) ?? [];
    list.push(rule);
    byCategory.set(rule.category, list);
  }

  const lines: string[] = [
    '# AI Coding Agent Rules',
    '',
    'Engineering guidelines and behavioral directives for AI coding agents working in this repository.',
  ];

  const orderedCategories: string[] = [
    ...ALL_CATEGORIES.filter((cat) => byCategory.has(cat)),
    ...[...byCategory.keys()].filter((cat) => !(ALL_CATEGORIES as readonly string[]).includes(cat)),
  ];

  for (const category of orderedCategories) {
    const catRules = byCategory.get(category);
    if (!catRules || catRules.length === 0) continue;

    lines.push('', `## ${category}`, '');
    for (const rule of catRules) {
      const cleanTitle = rule.title.trim().replace(/\.$/, '');
      const cleanSummary = rule.summary.trim();
      const isDistinctSummary =
        cleanSummary.length > 0 &&
        cleanSummary.replace(/\.$/, '').toLowerCase() !== cleanTitle.toLowerCase();

      if (options.includeSummaries && isDistinctSummary) {
        lines.push(`- **${cleanTitle}.** ${cleanSummary}`);
      } else {
        lines.push(`- **${cleanTitle}.**`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

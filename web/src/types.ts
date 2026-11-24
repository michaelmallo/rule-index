export type ThemeId = 'light' | 'dark' | 'solarized' | 'terminal';

export type SortOption = 'repos' | 'weighted' | 'trending';

export type MinAdoption = 0 | 5 | 25 | 100;

export interface RuleExample {
  text: string;
  repo: string;
  repo_url: string;
  file_path: string;
  file_url: string;
  stars: number;
  agent: string;
}

export interface CanonicalRule {
  id: string;
  title: string;
  summary: string;
  category: string;
  agents: string[];
  adoption_count: number;
  weighted_score: number;
  first_seen: string;
  last_updated: string;
  examples: RuleExample[];
}

export interface RuleDatasetStats {
  total_rules: number;
  total_repos_indexed: number;
  agents_covered: string[];
  categories: string[];
}

export interface RuleDataset {
  generated_at: string;
  stats: RuleDatasetStats;
  rules: CanonicalRule[];
}

export interface FilterState {
  query: string;
  agents: string[];
  categories: string[];
  minAdoption: MinAdoption;
  sort: SortOption;
}

export const ALL_AGENTS = [
  'Universal',
  'Claude',
  'Cursor',
  'Codex',
  'Cline',
  'Copilot',
  'Windsurf',
  'Gemini',
] as const;

export const AGENT_LABELS: Record<string, string> = {
  Universal: 'Universal (AGENTS.md)',
  Claude: 'Claude',
  Cursor: 'Cursor',
  Codex: 'Codex',
  Cline: 'Cline',
  Copilot: 'Copilot',
  Windsurf: 'Windsurf',
  Gemini: 'Gemini',
};

export const ALL_CATEGORIES = [
  'Code Style & Architecture',
  'Testing & Verification',
  'Git & Workflow',
  'Security & Secrets',
  'Tooling & Dependencies',
  'Communication & Planning',
  'Error Handling',
] as const;

export const MIN_ADOPTION_OPTIONS: { value: MinAdoption; label: string }[] = [
  { value: 0, label: 'All rules' },
  { value: 5, label: '5+ repos' },
  { value: 25, label: '25+ repos' },
  { value: 100, label: '100+ repos' },
];

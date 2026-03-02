export interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  patch: string;
}

export interface ImpactArea {
  area: string;
  description: string;
  risk: "high" | "medium" | "low";
  affected_urls: string[];
  suggested_actions: string[];
}

export interface DiffAnalysis {
  files: DiffFile[];
  summary: string;
  impact_areas: ImpactArea[];
}

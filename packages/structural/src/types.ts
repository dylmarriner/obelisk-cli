/**
 * Structural refactor adapter types.
 */

export interface StructuralMatch {
  file: string;
  line: number;
  column: number;
  content: string;
  variables: Record<string, string>;
}

export interface StructuralFindRequest {
  pattern: string;
  language: string;
  repoPath?: string;
  file?: string;
}

export interface RewriteChange {
  file: string;
  oldContent: string;
  newContent: string;
  line: number;
}

export interface RewritePreview {
  changes: RewriteChange[];
  summary: string;
  approvalRequired: boolean;
}

export interface StructuralRewriteRequest {
  pattern: string;
  rewrite: string;
  language: string;
  repoPath?: string;
  file?: string;
}

export interface StructuralIssue {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: "error" | "warning" | "info";
}

export interface StructuralScanRequest {
  rule?: string;
  ruleText?: string;
  repoPath?: string;
}

export interface ApplyResult {
  success: boolean;
  filesChanged: number;
  error?: string;
}

export interface StructuralRefactorAdapter {
  find(input: StructuralFindRequest): Promise<StructuralMatch[]>;
  rewrite(input: StructuralRewriteRequest): Promise<RewritePreview>;
  apply(input: { previewId: string }): Promise<ApplyResult>;
  scan(input: StructuralScanRequest): Promise<StructuralIssue[]>;
  available(): Promise<boolean>;
}
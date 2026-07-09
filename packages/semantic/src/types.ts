/**
 * Semantic code adapter types.
 */

export interface CodeSymbol {
  name: string;
  kind: string;
  file: string;
  line: number;
  column: number;
  signature?: string;
  documentation?: string;
  body?: string;
  children?: CodeSymbol[];
}

export interface CodeReference {
  symbol: string;
  file: string;
  line: number;
  column: number;
  context: string;
}

export interface ListSymbolsRequest {
  file?: string;
  depth?: number;
}

export interface FindSymbolRequest {
  name: string;
  file?: string;
  includeBody?: boolean;
  includeInfo?: boolean;
  maxMatches?: number;
}

export interface FindReferencesRequest {
  name: string;
  file: string;
}

export interface RenameSymbolRequest {
  name: string;
  file: string;
  newName: string;
}

export interface EditPlan {
  changes: { file: string; oldContent: string; newContent: string; line: number }[];
  summary: string;
}

export interface ApplyResult {
  success: boolean;
  filesChanged: number;
  error?: string;
}

export interface SemanticToolStatus {
  available: boolean;
  version?: string;
  project?: string;
  language?: string;
  error?: string;
}

export interface SemanticCodeAdapter {
  status(): Promise<SemanticToolStatus>;
  listSymbols(input: ListSymbolsRequest): Promise<CodeSymbol[]>;
  findSymbol(input: FindSymbolRequest): Promise<CodeSymbol[]>;
  findReferences(input: FindReferencesRequest): Promise<CodeReference[]>;
  prepareRename(input: RenameSymbolRequest): Promise<EditPlan>;
  available(): Promise<boolean>;
}
# Obelisk CLI — Adapter Contracts

This document defines the formal TypeScript interfaces for all adapter contracts in the Obelisk CLI system. Every external tool integration must implement its respective adapter contract.

## MemoryAdapter

```typescript
export interface MemoryAdapter {
  /** Check if the memory service is reachable and operational */
  health(): Promise<MemoryHealth>;

  /** Store a new memory record */
  remember(input: MemoryWrite): Promise<MemoryRecord>;

  /** Search memory records by query */
  recall(query: MemoryQuery): Promise<MemoryRecord[]>;

  /** Retrieve a single memory record by ID */
  get(id: string): Promise<MemoryRecord | null>;

  /** Remove a memory record */
  forget(input: MemoryForgetRequest): Promise<MemoryForgetResult>;

  /** Save an architectural decision record */
  saveDecision(input: ArchitecturalDecision): Promise<MemoryRecord>;

  /** Save a task history record */
  saveTaskHistory(input: TaskHistoryRecord): Promise<MemoryRecord>;

  /** Sync queued offline memory writes */
  syncOfflineQueue(): Promise<MemorySyncResult>;
}

export interface MemoryWrite {
  scope: MemoryScope;
  content: string;
  summary?: string;
  tags: string[];
  projectId?: string;
  sessionId?: string;
  source: "manual" | "agent" | "task" | "repo-analysis";
  sensitivity: "normal" | "private" | "secret-blocked";
}

export interface MemoryQuery {
  query: string;
  tags?: string[];
  scope?: MemoryScope;
  limit?: number;
  offset?: number;
}

export type MemoryScope =
  | "global_user"
  | "project"
  | "session"
  | "task_history"
  | "architecture_decision"
  | "repo_summary"
  | "preference";

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  projectId?: string;
  sessionId?: string;
  content: string;
  summary?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  source: string;
  sensitivity: string;
}

export interface MemoryHealth {
  ok: boolean;
  service: string;
  version: string;
  storage: string;
}

export interface MemorySyncResult {
  synced: number;
  remaining: number;
  errors?: string[];
}
```

## SearchAdapter

```typescript
export interface SearchAdapter {
  /** Index a repository for search */
  index(input: IndexRequest): Promise<IndexResult>;

  /** Search the indexed repository */
  search(input: SearchQuery): Promise<SearchResult[]>;

  /** Get index status */
  status(input: IndexStatusRequest): Promise<IndexStatus>;

  /** Rebuild the entire index */
  rebuild(input: RebuildIndexRequest): Promise<IndexResult>;
}

export interface SearchQuery {
  query: string;
  regex?: boolean;
  file?: string;
  maxResults?: number;
  repoPath: string;
}

export interface SearchResult {
  file: string;
  line: number;
  column: number;
  content: string;
  matchLength: number;
  score?: number;
}

export interface IndexStatus {
  indexed: boolean;
  lastIndexed?: string;
  fileCount: number;
  sizeBytes: number;
  repoPath: string;
}
```

## SemanticCodeAdapter

```typescript
export interface SemanticCodeAdapter {
  /** Check if the semantic service is operational */
  status(): Promise<SemanticToolStatus>;

  /** List all symbols in a file or project */
  listSymbols(input: ListSymbolsRequest): Promise<CodeSymbol[]>;

  /** Find a symbol by name */
  findSymbol(input: FindSymbolRequest): Promise<CodeSymbol[]>;

  /** Find all references to a symbol */
  findReferences(input: FindReferencesRequest): Promise<CodeReference[]>;

  /** Prepare a rename operation */
  prepareRename(input: RenameSymbolRequest): Promise<EditPlan>;

  /** Apply an edit plan */
  applyEditPlan(input: ApplyEditPlanRequest): Promise<ApplyResult>;
}

export interface CodeSymbol {
  name: string;
  kind: string;
  file: string;
  line: number;
  column: number;
  signature?: string;
  documentation?: string;
}

export interface CodeReference {
  symbol: string;
  file: string;
  line: number;
  column: number;
  context: string;
}
```

## StructuralRefactorAdapter

```typescript
export interface StructuralRefactorAdapter {
  /** Find code matching a structural pattern */
  find(input: StructuralFindRequest): Promise<StructuralMatch[]>;

  /** Preview a structural rewrite */
  rewrite(input: StructuralRewriteRequest): Promise<RewritePreview>;

  /** Scan for structural issues */
  scan(input: StructuralScanRequest): Promise<StructuralIssue[]>;

  /** Apply an approved rewrite */
  apply(input: ApplyRewriteRequest): Promise<ApplyResult>;
}

export interface StructuralFindRequest {
  pattern: string;
  language: string;
  repoPath: string;
  file?: string;
}

export interface StructuralMatch {
  file: string;
  line: number;
  column: number;
  content: string;
  variables: Record<string, string>;
}

export interface RewritePreview {
  changes: RewriteChange[];
  summary: string;
  approvalRequired: boolean;
}

export interface RewriteChange {
  file: string;
  oldContent: string;
  newContent: string;
  line: number;
}
```

## TokenControlAdapter

```typescript
export interface TokenControlAdapter {
  /** Inspect a context candidate for token usage */
  inspect(input: ContextCandidate): Promise<TokenReport>;

  /** Assemble a prompt from context sources */
  assemble(input: PromptAssemblyRequest): Promise<PromptAssemblyResult>;

  /** Enforce a policy on an agent action */
  enforcePolicy(input: AgentAction): Promise<PolicyDecision>;

  /** Compact context to fit within budget */
  compact(input: ContextCompactionRequest): Promise<CompactedContext>;
}

export interface TokenReport {
  totalTokens: number;
  inputTokens: number;
  reservedOutputTokens: number;
  maxTokens: number;
  exceedsBudget: boolean;
  sources: TokenSource[];
}

export interface TokenSource {
  name: string;
  tokens: number;
  percentage: number;
}

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
  requiresApproval: boolean;
  suggestedAction?: string;
}
```

## IndexerAdapter

```typescript
export interface IndexerAdapter {
  /** Initialize the index for a repository */
  init(input: IndexerInitRequest): Promise<IndexerStatus>;

  /** Update the index incrementally */
  update(input: IndexerUpdateRequest): Promise<IndexUpdateResult>;

  /** Watch a repository for changes and auto-index */
  watch(input: IndexerWatchRequest): AsyncIterable<IndexEvent>;

  /** Get the current index status */
  status(input: IndexerStatusRequest): Promise<IndexerStatus>;
}

export interface IndexEvent {
  type: "file-changed" | "file-added" | "file-removed" | "index-complete";
  path: string;
  timestamp: string;
}
```

## ModelProviderAdapter

```typescript
export interface ModelProviderAdapter {
  /** List available models */
  listModels(): Promise<ModelInfo[]>;

  /** Send a completion request */
  complete(input: ModelRequest): Promise<ModelResponse>;

  /** Stream a completion response */
  stream(input: ModelRequest): AsyncIterable<ModelEvent>;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  supportsStreaming: boolean;
  supportsFunctions: boolean;
  costPerInputToken: number;
  costPerOutputToken: number;
}

export interface ModelRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}
```
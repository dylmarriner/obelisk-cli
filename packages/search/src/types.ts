/**
 * Search adapter types and interfaces for Obelisk CLI.
 */

export interface SearchResult {
  file: string;
  repo?: string;
  line: number;
  column: number;
  content: string;
  matchLength: number;
  score?: number;
  branches?: string[];
}

export interface SearchQuery {
  query: string;
  regex?: boolean;
  file?: string;
  repo?: string;
  maxResults?: number;
  indexDir?: string;
}

export interface IndexRequest {
  repoPath: string;
  indexDir: string;
  name?: string;
  incremental?: boolean;
}

export interface IndexResult {
  fileCount: number;
  sizeBytes: number;
  durationMs: number;
  indexPath: string;
}

export interface IndexStatus {
  indexed: boolean;
  lastIndexed?: string;
  fileCount: number;
  sizeBytes: number;
  shardCount: number;
  indexPath: string;
}

export interface SearchAdapter {
  search(query: SearchQuery): Promise<SearchResult[]>;
  index(input: IndexRequest): Promise<IndexResult>;
  status(input: { indexDir: string }): Promise<IndexStatus>;
  rebuild(input: IndexRequest): Promise<IndexResult>;
  available(): Promise<boolean>;
}
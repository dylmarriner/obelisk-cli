/**
 * AstGrepAdapter — subprocess-based adapter for ast-grep structural search/refactor.
 *
 * ast-grep (https://github.com/ast-grep/ast-grep) is an AST-based code search
 * and rewrite tool. This adapter communicates via subprocess:
 *   sg -p <pattern> -l <lang>                    — find
 *   sg -p <pattern> -l <lang> --rewrite <r>      — rewrite (interactive)
 *   sg scan -r <rule>                             — scan with rule
 *
 * The eval/ast-grep/ directory contains the Rust source for reference.
 * Build with: cargo build in eval/ast-grep/
 */

import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { promisify } from "node:util";
import type {
  StructuralRefactorAdapter,
  StructuralMatch,
  StructuralFindRequest,
  StructuralRewriteRequest,
  RewritePreview,
  RewriteChange,
  StructuralIssue,
  StructuralScanRequest,
  ApplyResult,
} from "./types";

const execFile = promisify(cp.execFile);
const writeFile = promisify(fs.writeFile);

const SG_BINARY = "sg";

// ─── Adapter ─────────────────────────────────────────────────────

export class AstGrepAdapter implements StructuralRefactorAdapter {
  private binary: string;

  constructor(options: { binary?: string } = {}) {
    this.binary = options.binary || SG_BINARY;
  }

  // ─── Find ─────────────────────────────────────────────────────

  async find(input: StructuralFindRequest): Promise<StructuralMatch[]> {
    const args: string[] = [];

    // Pattern
    args.push("-p", input.pattern);

    // Language
    if (input.language) {
      args.push("-l", input.language);
    }

    // File filter
    if (input.file) {
      args.push(input.file);
    } else if (input.repoPath) {
      args.push(input.repoPath);
    }

    // JSON output for parsing
    args.push("--json");

    try {
      const { stdout, stderr } = await execFile(this.binary, args, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000,
        cwd: input.repoPath || process.cwd(),
      });

      if (stderr && stderr.includes("error")) {
        throw new Error(stderr.trim());
      }

      return this.parseFindResults(stdout);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw new Error(
          `ast-grep binary not found. Install with: cargo install ast-grep --locked`
        );
      }
      // If JSON output fails, try parsing text output
      if (err.stdout) {
        return this.parseTextResults(err.stdout as string);
      }
      throw err;
    }
  }

  // ─── Rewrite Preview ──────────────────────────────────────────

  async rewrite(input: StructuralRewriteRequest): Promise<RewritePreview> {
    // First, find all matches
    const matches = await this.find({
      pattern: input.pattern,
      language: input.language,
      repoPath: input.repoPath,
      file: input.file,
    });

    if (matches.length === 0) {
      return {
        changes: [],
        summary: "No matches found",
        approvalRequired: false,
      };
    }

    // Generate preview by showing what would change
    const changes: RewriteChange[] = matches.map((m) => ({
      file: m.file,
      oldContent: m.content,
      newContent: this.applyRewrite(m.content, input.pattern, input.rewrite, m.variables),
      line: m.line,
    }));

    const approvalRequired = changes.length > 5;
    const summary = `Found ${changes.length} match${changes.length > 1 ? "es" : ""} across ${new Set(changes.map((c) => c.file)).size} file(s)`;

    return {
      changes,
      summary,
      approvalRequired,
    };
  }

  // ─── Apply Rewrite ────────────────────────────────────────────

  async apply(input: { previewId: string }): Promise<ApplyResult> {
    // For ast-grep, we need to re-run with --rewrite flag
    // The previewId stores the original pattern and rewrite params
    const [pattern, rewrite, lang, ...paths] = input.previewId.split("|");
    const repoPath = paths.join("|") || process.cwd();

    const args: string[] = [
      "-p", pattern,
      "-l", lang,
      "--rewrite", rewrite,
      "--update-all", // Non-interactive mode
      "--json",
    ];

    if (paths.length > 0) {
      args.push(repoPath);
    }

    try {
      const { stdout, stderr } = await execFile(this.binary, args, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 60000,
        cwd: repoPath,
      });

      // Count changes from output
      const changes = this.parseFindResults(stdout);

      return {
        success: true,
        filesChanged: new Set(changes.map((c) => c.file)).size,
      };
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return { success: false, filesChanged: 0, error: "ast-grep binary not found" };
      }
      return { success: false, filesChanged: 0, error: err.message };
    }
  }

  // ─── Scan ─────────────────────────────────────────────────────

  async scan(input: StructuralScanRequest): Promise<StructuralIssue[]> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "obelisk-ast-"));
    const args: string[] = ["scan"];

    try {
      if (input.ruleText) {
        // Write rule text to a temp file
        const ruleFile = path.join(tmpDir, "rule.yml");
        await writeFile(ruleFile, input.ruleText, "utf-8");
        args.push("-r", ruleFile);
      } else if (input.rule) {
        args.push("-r", input.rule);
      }

      if (input.repoPath) {
        args.push(input.repoPath);
      }

      args.push("--json");

      const { stdout } = await execFile(this.binary, args, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 60000,
        cwd: input.repoPath || process.cwd(),
      });

      return this.parseScanResults(stdout);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw new Error("ast-grep binary not found");
      }
      if (err.stdout) {
        return this.parseScanResults(err.stdout as string);
      }
      throw err;
    } finally {
      // Cleanup temp directory
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // ─── Available ────────────────────────────────────────────────

  async available(): Promise<boolean> {
    try {
      await execFile(this.binary, ["--version"], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  // ─── Private: Parse Results ───────────────────────────────────

  private parseFindResults(output: string): StructuralMatch[] {
    const results: StructuralMatch[] = [];

    try {
      // Try JSON format first
      const parsed = JSON.parse(output);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          results.push({
            file: item.file || item.path || "",
            line: item.line || item.start?.line || 0,
            column: item.column || item.start?.column || 0,
            content: item.text || item.content || "",
            variables: item.variables || {},
          });
        }
        return results;
      }
    } catch {
      // Not JSON, fall through to text parsing
    }

    // Parse text output format: file:line:column:content
    for (const line of output.split("\n")) {
      const match = line.match(/^([^:]+):(\d+):(\d+):(.+)/);
      if (match) {
        results.push({
          file: match[1],
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          content: match[4].trim(),
          variables: {},
        });
      }
    }

    return results;
  }

  private parseScanResults(output: string): StructuralIssue[] {
    const issues: StructuralIssue[] = [];

    try {
      const parsed = JSON.parse(output);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          issues.push({
            file: item.file || item.path || "",
            line: item.line || item.start?.line || 0,
            column: item.column || item.start?.column || 0,
            message: item.message || item.rule?.message || "",
            severity: item.severity || "warning",
          });
        }
      }
    } catch {
      // Parse text output
      for (const line of output.split("\n")) {
        const match = line.match(/^([^:]+):(\d+):(\d+):(.+)/);
        if (match) {
          issues.push({
            file: match[1],
            line: parseInt(match[2], 10),
            column: parseInt(match[3], 10),
            message: match[4].trim(),
            severity: "warning",
          });
        }
      }
    }

    return issues;
  }

  private applyRewrite(content: string, pattern: string, rewrite: string, variables: Record<string, string>): string {
    let result = rewrite;

    // Replace meta-variables ($MATCH, $A, $B, etc.)
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\$\\b${key}\\b`, "g"), value);
    }

    // If no variables matched, return the rewrite as-is (simple replacement)
    if (result === rewrite && !rewrite.includes("$")) {
      return rewrite;
    }

    return result;
  }
}
/**
 * SecretRedactor — detects and redacts sensitive information from text.
 *
 * Scans for common secret patterns (API keys, tokens, private keys, env vars)
 * and replaces them with safe placeholders. Port of the obelisk Rust ledger
 * and filters secret-handling logic.
 */

// ─── Secret Pattern ──────────────────────────────────────────────

export interface SecretPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
  severity: "high" | "medium" | "low";
}

// ─── Built-in patterns ──────────────────────────────────────────

const BUILTIN_PATTERNS: SecretPattern[] = [
  // API keys
  { name: "OpenAI API Key", pattern: /sk-[A-Za-z0-9]{20,}/g, replacement: "sk-***REDACTED***", severity: "high" },
  { name: "Anthropic API Key", pattern: /sk-ant-[A-Za-z0-9]{20,}/g, replacement: "sk-ant-***REDACTED***", severity: "high" },
  { name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/g, replacement: "AKIA***REDACTED***", severity: "high" },
  { name: "GitHub Token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g, replacement: "gh_***REDACTED***", severity: "high" },
  { name: "GitLab Token", pattern: /glpat-[A-Za-z0-9_-]{20,}/g, replacement: "glpat-***REDACTED***", severity: "high" },
  { name: "Slack Token", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g, replacement: "xox-***REDACTED***", severity: "high" },
  { name: "Discord Token", pattern: /[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/g, replacement: "***REDACTED***", severity: "high" },
  { name: "Google API Key", pattern: /AIza[0-9A-Za-z_-]{35}/g, replacement: "AIza***REDACTED***", severity: "high" },
  { name: "JWT Token", pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: "eyJ***REDACTED***", severity: "medium" },
  { name: "Bearer Token", pattern: /Bearer\s+[A-Za-z0-9_-]{20,}/gi, replacement: "Bearer ***REDACTED***", severity: "medium" },
  { name: "Basic Auth", pattern: /Basic\s+[A-Za-z0-9+/=]{20,}/gi, replacement: "Basic ***REDACTED***", severity: "medium" },
  // Private keys
  { name: "RSA Private Key", pattern: /-----BEGIN RSA PRIVATE KEY-----[\s\S]*?-----END RSA PRIVATE KEY-----/g, replacement: "-----BEGIN RSA PRIVATE KEY-----\n***REDACTED***\n-----END RSA PRIVATE KEY-----", severity: "high" },
  { name: "EC Private Key", pattern: /-----BEGIN EC PRIVATE KEY-----[\s\S]*?-----END EC PRIVATE KEY-----/g, replacement: "-----BEGIN EC PRIVATE KEY-----\n***REDACTED***\n-----END EC PRIVATE KEY-----", severity: "high" },
  { name: "OpenSSH Private Key", pattern: /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g, replacement: "-----BEGIN OPENSSH PRIVATE KEY-----\n***REDACTED***\n-----END OPENSSH PRIVATE KEY-----", severity: "high" },
  // Generic
  { name: "Generic Password", pattern: /(password|passwd|pwd|secret)\s*[:=]\s*["']?[A-Za-z0-9!@#$%^&*()_+={}\[\]|;:',.<>?/`~-]{8,}["']?/gi, replacement: "$1: ***REDACTED***", severity: "medium" },
  { name: "API Key (generic)", pattern: /(api[_-]?key|apikey|api_secret)\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}["']?/gi, replacement: "$1: ***REDACTED***", severity: "medium" },
];

// ─── Redact Result ───────────────────────────────────────────────

export interface RedactResult {
  text: string;
  redacted: number;
  findings: SecretFinding[];
}

export interface SecretFinding {
  pattern: string;
  severity: string;
  count: number;
  positions: { start: number; end: number }[];
}

// ─── Redactor ────────────────────────────────────────────────────

export class SecretRedactor {
  private patterns: SecretPattern[];

  constructor(customPatterns: SecretPattern[] = []) {
    this.patterns = [...BUILTIN_PATTERNS, ...customPatterns];
  }

  /**
   * Scan and redact sensitive information from text.
   */
  redact(text: string): RedactResult {
    const findings: SecretFinding[] = [];
    let result = text;

    for (const pattern of this.patterns) {
      const matches: { start: number; end: number }[] = [];
      let match: RegExpExecArray | null;

      // Reset regex state
      pattern.pattern.lastIndex = 0;

      while ((match = pattern.pattern.exec(result)) !== null) {
        matches.push({ start: match.index, end: match.index + match[0].length });
      }

      if (matches.length > 0) {
        findings.push({
          pattern: pattern.name,
          severity: pattern.severity,
          count: matches.length,
          positions: matches.slice(0, 5), // Limit to first 5 positions
        });

        // Apply replacement
        pattern.pattern.lastIndex = 0;
        result = result.replace(pattern.pattern, pattern.replacement);
      }
    }

    const totalRedacted = findings.reduce((sum, f) => sum + f.count, 0);

    return {
      text: result,
      redacted: totalRedacted,
      findings,
    };
  }

  /**
   * Check if a file path should be protected (e.g., .env, private keys).
   */
  isProtectedPath(filePath: string): { protected: boolean; reason?: string } {
    const protectedPatterns = [
      { pattern: /(^|\/|\\)\.env/, reason: "Environment file" },
      { pattern: /(^|\/|\\)\.env\./, reason: "Environment file" },
      { pattern: /(^|\/|\\)id_rsa/, reason: "SSH private key" },
      { pattern: /(^|\/|\\)id_ed25519/, reason: "SSH private key" },
      { pattern: /(^|\/|\\)\.ssh\//, reason: "SSH directory" },
      { pattern: /\.pem$/, reason: "PEM certificate/key" },
      { pattern: /\.key$/, reason: "Private key file" },
      { pattern: /\.p12$/, reason: "PKCS12 keystore" },
      { pattern: /\.jks$/, reason: "Java keystore" },
      { pattern: /credentials\.json$/, reason: "Credentials file" },
      { pattern: /service-account\.json$/, reason: "Service account" },
      { pattern: /(^|\/|\\)kubeconfig/, reason: "Kubernetes config" },
      { pattern: /\.npmrc$/, reason: "npm config (may contain tokens)" },
      { pattern: /\.netrc$/, reason: "netrc credentials" },
    ];

    for (const { pattern, reason } of protectedPatterns) {
      if (pattern.test(filePath)) {
        return { protected: true, reason };
      }
    }

    return { protected: false };
  }

  /**
   * Add a custom secret pattern.
   */
  addPattern(pattern: SecretPattern): void {
    this.patterns.push(pattern);
  }
}
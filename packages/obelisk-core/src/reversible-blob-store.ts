/**
 * ReversibleBlobStore — stores original content before compression.
 *
 * Every byte that gets squeezed, terse-ified, or compacted is stashed here
 * first, keyed by a hash handle. The handle is emitted in the compressed
 * output so any agent can recover the original with `obelisk restore <handle>`.
 *
 * All blobs live under .obelisk/blobs/ — a simple content-addressed store.
 * Think of it as a reversible compression layer: minimize tokens, lose nothing.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const BLOBS_DIR = ".obelisk/blobs";

export class ReversibleBlobStore {
  private blobsDir: string;

  constructor(baseDir?: string) {
    this.blobsDir = path.join(baseDir || process.cwd(), BLOBS_DIR);
    fs.mkdirSync(this.blobsDir, { recursive: true });
  }

  /**
   * Store content and return a reversible handle.
   * The handle can be used later to restore the original.
   */
  store(content: string, label?: string): string {
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    const handle = label ? `${label}-${hash.slice(0, 12)}` : hash.slice(0, 16);

    const filePath = path.join(this.blobsDir, `${handle}.blob`);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, "utf-8");
    }

    return handle;
  }

  /**
   * Restore original content by handle.
   */
  restore(handle: string): string | null {
    const filePath = path.join(this.blobsDir, `${handle}.blob`);
    if (!fs.existsSync(filePath)) {
      // Try searching for partial match
      const files = fs.readdirSync(this.blobsDir);
      const match = files.find((f) => f.startsWith(handle));
      if (!match) return null;
      return fs.readFileSync(path.join(this.blobsDir, match), "utf-8");
    }
    return fs.readFileSync(filePath, "utf-8");
  }

  /**
   * Check if a handle exists.
   */
  has(handle: string): boolean {
    const filePath = path.join(this.blobsDir, `${handle}.blob`);
    if (fs.existsSync(filePath)) return true;
    const files = fs.readdirSync(this.blobsDir);
    return files.some((f) => f.startsWith(handle));
  }

  /**
   * Get stats about the blob store.
   */
  stats(): { totalBlobs: number; totalSizeBytes: number } {
    if (!fs.existsSync(this.blobsDir)) return { totalBlobs: 0, totalSizeBytes: 0 };

    const files = fs.readdirSync(this.blobsDir).filter((f) => f.endsWith(".blob"));
    let totalSize = 0;
    for (const file of files) {
      try {
        totalSize += fs.statSync(path.join(this.blobsDir, file)).size;
      } catch {}
    }

    return { totalBlobs: files.length, totalSizeBytes: totalSize };
  }

  /**
   * Evict blobs older than N days.
   */
  gc(days: number): number {
    if (!fs.existsSync(this.blobsDir)) return 0;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    let evicted = 0;

    for (const file of fs.readdirSync(this.blobsDir)) {
      if (!file.endsWith(".blob")) continue;
      try {
        const stat = fs.statSync(path.join(this.blobsDir, file));
        if (stat.mtimeMs < cutoff) {
          fs.rmSync(path.join(this.blobsDir, file));
          evicted++;
        }
      } catch {}
    }

    return evicted;
  }
}
import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["OBELISK_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["OBELISK_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("OBELISK_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  OBELISK_AUTO_HEAP_SNAPSHOT: truthy("OBELISK_AUTO_HEAP_SNAPSHOT"),
  OBELISK_GIT_BASH_PATH: process.env["OBELISK_GIT_BASH_PATH"],
  OBELISK_CONFIG: process.env["OBELISK_CONFIG"],
  OBELISK_CONFIG_CONTENT: process.env["OBELISK_CONFIG_CONTENT"],
  OBELISK_DISABLE_AUTOUPDATE: truthy("OBELISK_DISABLE_AUTOUPDATE"),
  OBELISK_ALWAYS_NOTIFY_UPDATE: truthy("OBELISK_ALWAYS_NOTIFY_UPDATE"),
  OBELISK_DISABLE_PRUNE: truthy("OBELISK_DISABLE_PRUNE"),
  OBELISK_DISABLE_TERMINAL_TITLE: truthy("OBELISK_DISABLE_TERMINAL_TITLE"),
  OBELISK_SHOW_TTFD: truthy("OBELISK_SHOW_TTFD"),
  OBELISK_DISABLE_AUTOCOMPACT: truthy("OBELISK_DISABLE_AUTOCOMPACT"),
  OBELISK_DISABLE_MODELS_FETCH: truthy("OBELISK_DISABLE_MODELS_FETCH"),
  OBELISK_DISABLE_MOUSE: truthy("OBELISK_DISABLE_MOUSE"),
  OBELISK_FAKE_VCS: process.env["OBELISK_FAKE_VCS"],
  OBELISK_SERVER_PASSWORD: process.env["OBELISK_SERVER_PASSWORD"],
  OBELISK_SERVER_USERNAME: process.env["OBELISK_SERVER_USERNAME"],
  OBELISK_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("OBELISK_DISABLE_FFF"),

  // Experimental
  OBELISK_EXPERIMENTAL_FILEWATCHER: Config.boolean("OBELISK_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  OBELISK_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("OBELISK_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  OBELISK_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("OBELISK_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  OBELISK_MODELS_URL: process.env["OBELISK_MODELS_URL"],
  OBELISK_MODELS_PATH: process.env["OBELISK_MODELS_PATH"],
  OBELISK_DB: process.env["OBELISK_DB"],

  OBELISK_WORKSPACE_ID: process.env["OBELISK_WORKSPACE_ID"],
  OBELISK_EXPERIMENTAL_WORKSPACES: enabledByExperimental("OBELISK_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get OBELISK_DISABLE_PROJECT_CONFIG() {
    return truthy("OBELISK_DISABLE_PROJECT_CONFIG")
  },
  get OBELISK_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("OBELISK_EXPERIMENTAL_REFERENCES")
  },
  get OBELISK_TUI_CONFIG() {
    return process.env["OBELISK_TUI_CONFIG"]
  },
  get OBELISK_CONFIG_DIR() {
    return process.env["OBELISK_CONFIG_DIR"]
  },
  get OBELISK_PURE() {
    return truthy("OBELISK_PURE")
  },
  get OBELISK_PERMISSION() {
    return process.env["OBELISK_PERMISSION"]
  },
  get OBELISK_PLUGIN_META_FILE() {
    return process.env["OBELISK_PLUGIN_META_FILE"]
  },
  get OBELISK_CLIENT() {
    return process.env["OBELISK_CLIENT"] ?? "cli"
  },
}

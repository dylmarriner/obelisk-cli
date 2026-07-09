/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://obelisk.ai",

  // GitHub
  github: {
    repoUrl: "https://github.com/anomalyco/obelisk",
    starsFormatted: {
      compact: "160K",
      full: "160,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/obelisk",
    discord: "https://discord.gg/obelisk",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "900",
    commits: "13,000",
    monthlyUsers: "7.5M",
  },
} as const

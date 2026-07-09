declare global {
  const OBELISK_VERSION: string
  const OBELISK_CHANNEL: string
}

export const InstallationVersion = typeof OBELISK_VERSION === "string" ? OBELISK_VERSION : "local"
export const InstallationChannel = typeof OBELISK_CHANNEL === "string" ? OBELISK_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"

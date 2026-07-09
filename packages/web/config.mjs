const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://obelisk.ai" : `https://${stage}.obelisk.ai`,
  console: stage === "production" ? "https://obelisk.ai/auth" : `https://${stage}.obelisk.ai/auth`,
  email: "help@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/anomalyco/obelisk",
  discord: "https://obelisk.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}

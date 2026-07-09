import path from "path"

process.env.OBELISK_DB = ":memory:"
process.env.OBELISK_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.OBELISK_DISABLE_MODELS_FETCH = "true"

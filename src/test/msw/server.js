import { setupServer } from "msw/node"
import { postgrestHandlers } from "./postgrest"
import { externalHandlers } from "./externals"

export const server = setupServer(...postgrestHandlers, ...externalHandlers)

export { stubRpc, stubEdgeFunction, resetStubs } from "./postgrest"
export {
  resetExternalStubs,
  stubAuthUser,
  stubCloudinaryUpload,
  stubGeminiResponse,
  stubGithubCommits,
} from "./externals"

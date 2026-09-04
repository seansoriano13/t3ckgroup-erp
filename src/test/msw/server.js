import { setupServer } from "msw/node"
import { postgrestHandlers } from "./postgrest"
import { externalHandlers } from "./externals"
import { storageHandlers } from "./storage"

export const server = setupServer(...postgrestHandlers, ...externalHandlers, ...storageHandlers)

export { stubRpc, stubEdgeFunction, resetStubs } from "./postgrest"
export {
  resetExternalStubs,
  stubAuthUser,
  stubBrochure,
  stubCloudinaryUpload,
  stubGeminiResponse,
  stubGithubCommits,
} from "./externals"
export { resetStorageStubs, seedStorageObject } from "./storage"

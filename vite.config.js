import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'
import Generouted from '@generouted/react-router/plugin'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// __APP_VERSION__ is a cache-buster (the update toast compares it to
// version.json to notice a new deploy landed), not a release number — it
// changes on every build. __APP_SEMVER__ is the release number a human
// reads: src/data/changelog.json[0].version is the single source of truth
// for it, since that file is what both the "What's New" modal and
// last_seen_changelog_version already treat as the current release.
const appVersion = process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString()
const buildTime = new Date().toISOString()

import fs from "fs"
import { visibleEntries } from './scripts/lib/changelog.mjs'

function readChangelog() {
    try {
        const changelogPath = path.resolve(__dirname, 'src/data/changelog.json')
        const changelog = JSON.parse(fs.readFileSync(changelogPath, 'utf8'))
        return Array.isArray(changelog) ? changelog : []
    } catch (e) {
        console.error('Failed to parse src/data/changelog.json', e)
        return []
    }
}


function versionGeneratorPlugin() {
    return {
            name: 'version-generator-plugin',
            generateBundle() {
                this.emitFile({
                    type: 'asset',
                    fileName: 'version.json',
                    source: JSON.stringify({
                        version: appVersion,
                        builtAt: buildTime,
                    }, null, 2),
                })
            },
        }
    }

    // https://vite.dev/config/
    export default defineConfig(({ mode }) => {
        // Source maps go to Bugsink only on a build that has the upload token (set in
        // Vercel as BUGSINK_URL / BUGSINK_AUTH_TOKEN, deliberately without a VITE_
        // prefix so they never reach the client bundle). Elsewhere the build is
        // unchanged and ships no maps.
        const env = loadEnv(mode, process.cwd(), '')
        const uploadSourceMaps = Boolean(env.BUGSINK_URL && env.BUGSINK_AUTH_TOKEN)

        return {
        plugins: [
            react(),
            tailwindcss(),
            Generouted(),
            versionGeneratorPlugin(),
            uploadSourceMaps && sentryVitePlugin({
                org: 'bugsinkhasnoorgs',
                project: 't3ckgroup-erp',
                url: env.BUGSINK_URL,
                authToken: env.BUGSINK_AUTH_TOKEN,
                telemetry: false,
                release: { name: appVersion, create: false, finalize: false, inject: true },
                // The maps are for Bugsink only; do not serve them from Vercel.
                sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
            }),
        ],
        build: { sourcemap: uploadSourceMaps ? 'hidden' : false },
        define: {
            __APP_VERSION__: JSON.stringify(appVersion),
            __APP_SEMVER__: JSON.stringify(visibleEntries(readChangelog(), mode === 'staging' || process.env.VITE_APP_ENV === 'staging')[0]?.version || 'dev'),
            __BUILD_TIME__: JSON.stringify(buildTime),
        },
        resolve: {
            alias: {
                "@": path.resolve(__dirname, "./src"),
            },
        },
    }
})

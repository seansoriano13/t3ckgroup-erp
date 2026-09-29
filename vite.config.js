import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import Generouted from '@generouted/react-router/plugin'
import tailwindcss from '@tailwindcss/vite'
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

const latestChangelogEntry = readChangelog()[0]
const appSemver = latestChangelogEntry?.version || 'dev'

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
export default defineConfig({
    plugins: [react(), tailwindcss(), Generouted(), versionGeneratorPlugin()],
    define: {
        __APP_VERSION__: JSON.stringify(appVersion),
        __APP_SEMVER__: JSON.stringify(appSemver),
        __BUILD_TIME__: JSON.stringify(buildTime),
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
})

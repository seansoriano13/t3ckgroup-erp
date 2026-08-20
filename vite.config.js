import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import Generouted from '@generouted/react-router/plugin'
import tailwindcss from '@tailwindcss/vite'
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const appVersion = process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString()

function versionGeneratorPlugin() {
    return {
        name: 'version-generator-plugin',
        generateBundle() {
            this.emitFile({
                type: 'asset',
                fileName: 'version.json',
                source: JSON.stringify({
                    version: appVersion,
                    builtAt: new Date().toISOString(),
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
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
})

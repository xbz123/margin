import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { version } from './package.json'
import identityConfig from './scripts/margin/app-identity.cjs'

// Inject version so the React frontend can read it via import.meta.env.VITE_APP_VERSION
process.env.VITE_APP_VERSION = version;
const identity = identityConfig.selectIdentity();
process.env.VITE_APP_NAME = identity.name;

// https://vitejs.dev/config/
export default defineConfig({
    define: { __MARGIN_APP_NAME__: JSON.stringify(identity.name) },
    plugins: [react()],
    base: './', // Use relative paths for Electron
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
            "@hooks": path.resolve(__dirname, "./src/hooks"),
            "@config": path.resolve(__dirname, "./src/config"),
        },
    },
    server: {
        port: 5180,
        watch: {
            ignored: [
                '**/.claude/worktrees/**',
                '**/.code-review-graph/**',
                '**/dist-electron/**',
                '**/release/**',
            ],
        },
    },
    build: {
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
            output: {
                manualChunks: {
                    vendor: ['react', 'react-dom', 'framer-motion'],
                    ui: ['lucide-react', '@radix-ui/react-dialog', '@radix-ui/react-toast']
                }
            }
        }
    }
})

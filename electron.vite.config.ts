import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'computer-use-mcp-node-entry': resolve('src/main/computer-use-mcp-node-entry.ts'),
          'schedule-mcp-node-entry': resolve('src/main/schedule-mcp-node-entry.ts'),
          'research-search-mcp-node-entry': resolve('src/main/research-search-mcp-node-entry.ts'),
          'workflow-mcp-node-entry': resolve('src/main/workflow-mcp-node-entry.ts'),
          'workspace-intel-mcp-node-entry': resolve('src/main/workspace-intel-mcp-node-entry.ts'),
          'write-assist-mcp-node-entry': resolve('src/main/write-assist-mcp-node-entry.ts'),
          'paper-radar-mcp-node-entry': resolve('src/main/paper-radar-mcp-node-entry.ts'),
          'runtime-inspector-mcp-node-entry': resolve('src/main/runtime-inspector-mcp-node-entry.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})

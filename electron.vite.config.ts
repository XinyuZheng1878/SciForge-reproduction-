import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['react-markdown', 'remark-parse', 'remark-gfm', 'remark-math', 'rehype-katex', 'unified'] })],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        },
        input: {
          index: resolve('backend/main/index.ts'),
          'schedule-mcp-node-entry': resolve('backend/main/mcp/schedule-mcp-node-entry.ts'),
          'research-search-mcp-node-entry': resolve('backend/main/mcp/research-search-mcp-node-entry.ts'),
          'workflow-mcp-node-entry': resolve('backend/main/mcp/workflow-mcp-node-entry.ts'),
          'workspace-intel-mcp-node-entry': resolve('backend/main/mcp/workspace-intel-mcp-node-entry.ts'),
          'remote-executor-mcp-node-entry': resolve('backend/main/mcp/remote-executor-mcp-node-entry.ts'),
          'write-assist-mcp-node-entry': resolve('backend/main/mcp/write-assist-mcp-node-entry.ts'),
          'paper-radar-mcp-node-entry': resolve('backend/main/mcp/paper-radar-mcp-node-entry.ts'),
          'runtime-inspector-mcp-node-entry': resolve('backend/main/mcp/runtime-inspector-mcp-node-entry.ts'),
          'scientific-skills-mcp-node-entry': resolve('backend/main/mcp/scientific-skills-mcp-node-entry.ts'),
          'scientific-plotting-mcp-node-entry': resolve('backend/main/mcp/scientific-plotting-mcp-node-entry.ts'),
          'image-generation-mcp-node-entry': resolve('backend/main/mcp/image-generation-mcp-node-entry.ts'),
          'ppt-master-mcp-node-entry': resolve('backend/main/mcp/ppt-master-mcp-node-entry.ts'),
          'sciforge-canvas-mcp-node-entry': resolve('backend/main/mcp/sciforge-canvas-mcp-node-entry.ts')
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
        },
        input: {
          index: resolve('backend/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve('frontend'),
    build: {
      rollupOptions: {
        input: resolve('frontend/index.html')
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('frontend'),
        '@shared': resolve('backend/shared')
      }
    },
    plugins: [react()]
  }
})

import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  server: {
    host: '::',
    port: 5173,
    allowedHosts: true,
    cors: true,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // 只打包作品集本体：public/ 下那 13MB 海报图是 pptx 工具链用的，网页端不引用
    copyPublicDir: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        404: resolve(__dirname, '404.html')
      }
    }
  }
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    /**

     * 开发环境 API 代理。

     *

     * 前端请求：

     * /api/v1/conversations/messages

     *

     * 实际转发：

     * http://localhost:8000/api/v1/conversations/messages

     */

    proxy: {
      '/api': {
        target: 'http://localhost:8000',

        changeOrigin: true,

        secure: false,
      },
      '/outputs': {
        target: 'http://localhost:8000',

        changeOrigin: true,

        secure: false,
      },
    },
  },
})

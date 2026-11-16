import { defineConfig } from 'vite';
export default defineConfig({build:{outDir:'dist',rollupOptions:{output:{manualChunks:{react:['react','react-dom'],supabase:['@supabase/supabase-js'],validation:['zod']}}}}, server:{port:5173}});

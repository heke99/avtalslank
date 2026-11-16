import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/browser',timeout:30000,fullyParallel:false,workers:1,use:{baseURL:'http://127.0.0.1:5173',headless:true,launchOptions:{executablePath:process.env.CHROMIUM_PATH||(process.env.CI?undefined:'/usr/bin/chromium'),args:['--no-sandbox','--disable-dev-shm-usage']}},reporter:[['list']],outputDir:'test-results'});

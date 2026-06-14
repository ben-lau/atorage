import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'drivers/index': 'src/drivers/index.ts',
    'middleware/index': 'src/middleware/index.ts',
    'debug/index': 'src/debug/index.ts',
    'test/index': 'src/test/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  outExtension: () => ({ js: '.mjs' }),
})

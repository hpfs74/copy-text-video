import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
  plugins: [
    {
      name: 'css-as-text',
      transform(code, id) {
        if (!id.endsWith('.css')) return null;
        return { code: `export default ${JSON.stringify(code)};`, map: null };
      },
    },
  ],
});

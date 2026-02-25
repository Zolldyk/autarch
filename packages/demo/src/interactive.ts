import { runDemo } from './demo-scenario.js';

runDemo({ interactive: true }).catch((err: unknown) => {
  console.error('Interactive demo failed:', err);
  process.exit(1);
});

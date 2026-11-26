import { seed } from './seed.js';
const r = seed();
console.log(r.didRun ? 'seed done' : 'already seeded');
process.exit(0);

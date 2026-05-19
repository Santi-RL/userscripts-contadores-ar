import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(rootDir, '..');
const userscriptsDir = path.join(projectRoot, 'userscripts');
const outputDir = path.join(projectRoot, 'artifacts');
const outputFile = path.join(outputDir, 'SHA256SUMS.txt');

const scriptDirs = await fs.readdir(userscriptsDir, { withFileTypes: true });
const lines = [];

for (const entry of scriptDirs) {
  if (!entry.isDirectory()) continue;
  const scriptPath = path.join(userscriptsDir, entry.name, `${entry.name}.user.js`);
  const content = await fs.readFile(scriptPath);
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  lines.push(`${digest}  userscripts/${entry.name}/${entry.name}.user.js`);
}

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(outputFile, `${lines.join('\n')}\n`, 'utf8');
console.log(`Checksums escritos en ${path.relative(projectRoot, outputFile)}.`);

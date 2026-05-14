import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const archiver = require('archiver');
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputPaths = [
  path.join(__dirname, 'public', 'chatgpt-extractor.zip'),
  path.join(__dirname, 'dist', 'chatgpt-extractor.zip')
];

for (const outputPath of outputPaths) {
  // make sure dist exists if we write to it
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const output = fs.createWriteStream(outputPath);
  const archive = archiver('zip', {
    zlib: { level: 9 } // Sets the compression level.
  });
  
  output.on('close', function() {
    console.log(archive.pointer() + ' total bytes written to ' + outputPath);
  });
  
  archive.on('error', function(err) {
    throw err;
  });
  
  archive.pipe(output);
  archive.directory(path.join(__dirname, 'public', 'extension'), 'chatgpt-extractor');
  archive.finalize();
}

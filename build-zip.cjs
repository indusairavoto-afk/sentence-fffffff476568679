const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const outputPaths = [
  path.join(__dirname, 'public', 'chatgpt-extractor.zip'),
  path.join(__dirname, 'dist', 'chatgpt-extractor.zip')
];

for (const outputPath of outputPaths) {
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const output = fs.createWriteStream(outputPath);
  const archive = new archiver.ZipArchive({
    zlib: { level: 9 }
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

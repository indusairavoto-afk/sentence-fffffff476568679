import fs from 'fs';
fetch('https://chatgpt.com/share/672fcbbf-4a94-8004-94c3-e8ecf6a2d9ee')
  .then(res => res.text())
  .then(text => fs.writeFileSync('test_chatgpt.html', text))
  .catch(console.error);

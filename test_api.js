import { readFileSync } from 'fs';

async function testApi() {
  const fetch = (await import('node-fetch')).default;
  try {
    const html = readFileSync('test_chatgpt.html', 'utf8');
    const res = await fetch('http://localhost:3000/api/extract-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html })
    });
    console.log(res.status, await res.text());
  } catch (err) {
    console.error(err);
  }
}
testApi();

import puppeteer from 'puppeteer-core';
async function run() {
  const browser = await puppeteer.connect({ browserWSEndpoint: 'wss://chrome.browserless.io?token=' + (process.env.BROWSERLESS_TOKEN || '2UUaQFRvjHXBtgr795905758f6356784b8fd41eb7bf39d987') });
  const page = await browser.newPage();
  await page.goto('https://chatgpt.com/share/67d4bbce-cba8-4c17-bffa-e77a2af5efba', { waitUntil: 'domcontentloaded' });
  const html = await page.content();
  const fs = await import('fs');
  fs.writeFileSync('chat.html', html);
  await browser.close();
  console.log("Done");
}
run();

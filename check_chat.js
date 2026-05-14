import fs from 'fs';
const html = fs.readFileSync('chat.html', 'utf8');
console.log("length:", html.length);
if (html.includes("data-message-author-role")) console.log("Has data-message-author-role");
if (html.includes("This is a copy")) console.log("Has This is a copy");
if (html.includes("next_f")) console.log("Has next_f");
if (html.includes("next-route-announcer")) console.log("Has next route announcer");
if (html.includes("__remixContext")) console.log("Has remix context");
if (html.includes("Cloudflare")) console.log("Has Cloudflare");

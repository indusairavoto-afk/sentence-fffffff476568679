import express from "express";

import path from "path";
import fs from "fs";
import * as cheerio from "cheerio";
import { convert } from "html-to-text";
import crypto from "crypto";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

import axios from 'axios';

const ALLOWED_TAGS = new Set([
  'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'ul', 'ol', 'li', 'strong', 'em', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'span', 'div', 'a'
]);

// Helper to clean HTML while preserving structure
function cleanHtml($, el) {
  let output = '';
  
  function walk(node) {
    if (node.type === 'text') {
      output += node.data.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    } else if (node.type === 'tag') {
      const tagName = node.name.toLowerCase();
      const isAllowed = ALLOWED_TAGS.has(tagName);
      
      if (isAllowed) {
        // preserve href for a tags?
        if (tagName === 'a' && node.attribs && node.attribs.href) {
           const href = node.attribs.href.replace(/"/g, '&quot;');
           output += '<' + tagName + ' href="' + href + '">';
        } else {
           output += '<' + tagName + '>';
        }
      }
      
      $(node).contents().each((_, child) => walk(child));
      
      if (isAllowed) {
        output += '</' + tagName + '>';
      }
    }
  }
  
  $(el).contents().each((_, child) => walk(child));
  return output.trim();
}

import puppeteer from 'puppeteer-core';

async function extractChatViaAxios(url: string) {
  let data = "";
  let usedPuppeteer = false;
  
  const browserlessToken = process.env.BROWSERLESS_TOKEN || "2UUaQFRvjHXBtgr795905758f6356784b8fd41eb7bf39d987";
  
  try {
    usedPuppeteer = true;
    console.log("Fetching via Browserless /content API...");
    const response = await axios.post(`https://chrome.browserless.io/content?token=${browserlessToken}`, {
      url: url,
      elements: [{ selector: "[data-message-author-role], article, .markdown, .prose, main" }], // ensure we wait for content
      stealth: true,
      wait: 2000,
      gotoOptions: {
        waitUntil: "networkidle2",
        timeout: 30000
      }
    }, {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      timeout: 35000
    });
    
    data = response.data;
    
    if (data.includes('404<!-- --> <!-- -->Not Found') || data.includes('<title>404 Not Found</title>')) {
      throw new Error("CHAT_DELETED");
    }
  } catch (error: any) {
    console.error("Browserless REST fetch failed, falling back to proxy:", error.message);
    if (error.response?.data) console.error("Browserless Error HTML:", error.response.data);
    if (error.message && error.message.includes("CHAT_DELETED")) throw error;
    
    // Fallback to Jina Reader proxy
    try {
      console.log("Puppeteer fetch failed, falling back to Jina proxy...");
      const proxyUrl = "https://r.jina.ai/" + url;
      const response = await axios.get(proxyUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "X-Return-Format": "html"
        },
        timeout: 20000 
      });
      data = response.data;
    } catch (jinaError: any) {
      console.error("Jina fetch failed, falling back to allorigins proxy:", jinaError.message);
      
      // Fallback to allorigins proxy
      try {
        const proxyUrl = "https://api.allorigins.win/raw?url=" + encodeURIComponent(url);
        const response = await axios.get(proxyUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          },
          timeout: 20000 
        });
        data = response.data;
      } catch (proxyError: any) {
        console.error("Proxy fetch failed, falling back to direct fetch:", proxyError.message);
        const response = await axios.get(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          },
          timeout: 20000 
        });
        data = response.data;
      }
    }
  }

  return extractMessagesFromHtml(data);
}


const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});
turndownService.use(gfm);


const app = express();
const MAX_DEBUG_LOGS = 500;
let debugLogs: string[] = [];
const origLog = console.log;
console.log = function (...args) {
  try {
    debugLogs.push(args.map(a => {
      try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch(e) { return String(a); }
    }).join(" "));
    if (debugLogs.length > MAX_DEBUG_LOGS) debugLogs.shift();
  } catch(e) {}
  origLog(...args);
};
const origErr = console.error;
console.error = function (...args) {
  try {
    debugLogs.push("ERR: " + args.map(a => {
      try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch(e) { return String(a); }
    }).join(" "));
    if (debugLogs.length > MAX_DEBUG_LOGS) debugLogs.shift();
  } catch(e) {}
  origErr(...args);
};
app.get("/api/debug-logs", (req, res) => res.json(debugLogs));
const PORT = parseInt(process.env.PORT || "5000", 10);

app.use(express.json({ limit: "50mb" }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/chatgpt-extractor.zip", (req, res) => {
  let zipPath = path.join(process.cwd(), "dist", "chatgpt-extractor.zip");
  if (!fs.existsSync(zipPath)) {
    zipPath = path.join(process.cwd(), "public", "chatgpt-extractor.zip");
  }
  
  if (fs.existsSync(zipPath)) {
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=chatgpt-extractor.zip");
    res.sendFile(zipPath);
  } else {
    res.status(404).send("Zip file not found");
  }
});

// Setup storage for images
const storageDir = path.join(process.cwd(), "storage", "images");
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}
app.use("/images", express.static(storageDir));

// Clean up images older than 7 minutes periodically
setInterval(() => {
  try {
    const now = Date.now();
    const files = fs.readdirSync(storageDir);
    let deleted = 0;
    files.forEach((file) => {
      const filePath = path.join(storageDir, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > 7 * 60 * 1000) { // 7 minutes
        fs.unlinkSync(filePath);
        deleted++;
      }
    });
    if (deleted > 0) console.log(`Cleaned up ${deleted} old images from storage (7m expiry)`);
  } catch (err) {
    console.error("Failed to clean up old images:", err);
  }
}, 60 * 1000); // Check every 1 minute

// Generates a public text link readable by external AI bots (like Claude)
app.post("/api/public-bridge", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Text content is required" });
    }

    // We use dpaste.com to generate a temporary public URL that bots can scrape without auth walls
    const response = await fetch("https://dpaste.com/api/v2/", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        content: text,
        format: "url",
        syntax: "md",
        expiry_days: "1",
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Public link generation failed: ${response.status}`);
    }

    const url = (await response.text()).trim();
    // Add .txt extension to ensure AI scrapers get the raw text directly
    res.json({ url: url + ".txt" });
  } catch (error: any) {
    console.error("Bridge error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Helper to parse provided HTML contents
app.post("/api/parse", async (req, res) => {
  try {
    const { html } = req.body;
    if (!html) {
      return res.status(400).json({ error: "HTML is required" });
    }

    const $ = cheerio.load(html);
    const title = $("title").text() || "Extracted Chat";
    const messages: any[] = [];

    $("[data-message-author-role]").each((i, el) => {
      let role = $(el).attr("data-message-author-role");
      if (role !== "user" && role !== "assistant") {
        role = "assistant"; // default fallback
      }

      let target = $(el).find('.markdown');
      if (target.length === 0) {
        target = $(el) as any;
      } else {
        target = target.first();
      }

      const contentHtml = cleanHtml($, target);
      messages.push({
        role: role,
        content_html: contentHtml,
      });
    });

    const now = Date.now();
    const formattedMessages = messages.map((m, index) => ({
      role: m.role,
      content_html: m.content_html,
      content: m.content_html || "",
      timestamp: new Date(now - (messages.length - index) * 60000).toISOString(),
    }));

    res.json({ title, messages: formattedMessages });
  } catch (error: any) {
    console.error("Parse error:", error);
    res.status(500).json({ error: "Parsing failed", details: error.message });
  }
});

// Deprecated or proxy extract route if needed
app.post("/api/extract", async (req, res) => {
  try {
    const { url, extractImages = true } = req.body;
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    console.log(
      `Extracting from URL via Puppeteer: ${url} (extractImages: ${extractImages})`,
    );

    // Enforce an absolute overarching timeout of 45 seconds to prevent 502/OOM proxy drop
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("EXTRACTION_TIMEOUT")), 45000)
    );

    const { title, messages } = (await Promise.race([ extractChatViaAxios(url), timeoutPromise ])) as { title: string, messages: any[] };

    // Format them for the frontend
    const now = Date.now();
    const formattedMessages = messages.map((m, index) => ({ 
      role: m.role, 
      content_html: m.content_html || m.content || '', 
      content: m.content || m.content_html || '', 
      timestamp: m.timestamp || new Date(now - (messages.length - index) * 60000).toISOString() 
    }));

    // If completely empty, just return error
    if (formattedMessages.length === 0) {
      const isChatGPT = url.includes("chatgpt.com");
      return res.status(422).json({
        error: "PARSING_FAILED",
        message: isChatGPT
          ? "ChatGPT's anti-bot system is blocking our cloud servers. If deploying to Render, the default headless token might be exhausted."
          : "Could not find any chat messages in the provided URL using Puppeteer extraction.",
        suggestion: isChatGPT
          ? "Set a custom BROWSERLESS_TOKEN in Render environment variables, or use physical HTML upload (AI CHAT TO PDF)."
          : "The link might be private, or the platform structure has changed.",
      });
    }

    res.json({ title, messages: formattedMessages });
  } catch (error: any) {
    if (error.message && error.message.includes("CHAT_DELETED")) {
      return res.status(404).json({
        error: "CHAT_DELETED",
        message: "The shared chat you provided has been deleted by its owner.",
        suggestion: "Please try another valid chat share link.",
      });
    }

    if (error.message && error.message.includes("LOGIN_REQUIRED")) {
      return res.status(403).json({
        error: "LOGIN_REQUIRED",
        message: "This platform now requires you to be logged in to view shared chats.",
        suggestion: "Please use the 'AI Chat to PDF' method instead. Save the page as HTML in your browser and upload it here.",
      });
    }

    if (error.message && error.message.includes("CLOUDFLARE_BLOCKED")) {
      console.warn("Extraction blocked by Cloudflare for URL:", req.body.url);
      return res.status(403).json({
        error: "CLOUDFLARE_BLOCKED",
        message:
          "This link is protected by Cloudflare and cannot be extracted automatically.",
        suggestion:
          "Please use the 'Save as HTML' method directly in your browser and use the 'Upload HTML File' option instead.",
      });
    }

    console.error("Extraction error:", error);

    if (
      error.name === "TimeoutError" ||
      (error.message && error.message.toLowerCase().includes("timeout")) ||
      (error.message && error.message.includes("TargetCloseError")) ||
      error.message === "EXTRACTION_TIMEOUT"
    ) {
      return res.status(504).json({
        error: "TIMEOUT",
        message:
          "Extraction timed out. If you are hosting on Render, the default headless API limit might be reached, and local bypass failed. Please create a free account at Browserless.io and add BROWSERLESS_TOKEN to your environment variables on Render.",
        suggestion:
          "Try again later, add a custom BROWSERLESS_TOKEN, or use Markdown/HTML export instead.",
      });
    }

    res.status(500).json({
      error: "EXTRACTION_ERROR",
      message:
        error.message || "An unexpected error occurred during extraction.",
    });
  }
});

app.post("/api/extract-html", async (req, res) => {
  try {
    const { html } = req.body;
    if (!html || html.length < 100) {
      return res.status(400).json({
        error: "INVALID_INPUT",
        message:
          "The uploaded file is empty or too small to be a valid chat export.",
      });
    }

    const { title, messages, isDeadLink, deadLinkMessage } = extractMessagesFromHtml(html);

    if (isDeadLink) {
      return res.status(404).json({
        error: "CHAT_NOT_FOUND",
        message: deadLinkMessage,
        suggestion: "This chat link is no longer valid. Ensure the share link is active."
      });
    }

    if (messages.length === 0) {
      return res.status(422).json({
        error: "PARSING_FAILED",
        message: "Could not extract structured messages from this HTML file.",
        suggestion:
          'Ensure you saved the "Complete" page (Ctrl+S) and didn\'t change the filename extension.',
      });
    }

    const now = Date.now();

    // Download images if possible
    for (const msg of messages) {
      msg.imagesUrls = msg.imagesUrls || [];
      const localImages = [];
      for (let i = 0; i < msg.imagesUrls.length; i++) {
        const imgUrl = msg.imagesUrls[i];
        const urlParts = imgUrl.split("?")[0].split("/");
        const lastPart = urlParts[urlParts.length - 1] || "";
        const extMatch = lastPart.match(/\.([a-zA-Z0-9]{1,4})$/);
        const ext = extMatch ? extMatch[1].toLowerCase() : "png";
        const filename = `${crypto.randomUUID()}.${ext}`;
        const filepath = path.join(
          process.cwd(),
          "storage",
          "images",
          filename,
        );

        try {
          // Only try to fetch if it's a real absolute URL, avoid data URIs or relative paths
          if (imgUrl.startsWith("http")) {
            const response = await fetch(imgUrl, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Referer: "https://chatgpt.com/",
              },
            });
            if (response.ok) {
              const arrayBuffer = await response.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);
              fs.writeFileSync(filepath, buffer);
              localImages.push(`images/${filename}`);
            } else {
              localImages.push(imgUrl);
            }
          } else if (imgUrl.startsWith("data:image")) {
            // handle data URIs
            const matches = imgUrl.match(
              /^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/,
            );
            if (matches && matches.length === 3) {
              const buffer = Buffer.from(matches[2], "base64");
              fs.writeFileSync(filepath, buffer);
              localImages.push(`images/${filename}`);
            } else {
              localImages.push(imgUrl);
            }
          } else {
            localImages.push(imgUrl);
          }
        } catch (err) {
          console.error(`Failed to download ${imgUrl}:`, err);
          localImages.push(imgUrl);
        }
      }
      (msg as any).images = localImages;
    }

    const formattedMessages = messages.map((m, index) => ({
      role: m.role,
      content: m.content,
      images: (m as any).images || [],
      timestamp:
        m.timestamp ||
        new Date(now - (messages.length - index) * 60000).toISOString(),
    }));

    res.json({ title, messages: formattedMessages });
  } catch (error: any) {
    console.error("Extraction error:", error);
    res.status(500).json({
      error: "EXTRACTION_ERROR",
      message: (error.message && error.message.includes("fetch")) ? "Failed to download image. The image server might be blocking the request." : (error.message || "Failed to process the uploaded HTML file."),
    });
  }
});

function extractJsonObject(text: string, prefix: string) {
  const index = text.indexOf(prefix);
  if (index === -1) return null;
  let startIndex = index + prefix.length;
  // Skip whitespace
  while (startIndex < text.length && /\s/.test(text[startIndex])) startIndex++;

  if (text[startIndex] !== "{" && text[startIndex] !== "[") return null;

  const isArray = text[startIndex] === "[";
  const openChar = isArray ? "[" : "{";
  const closeChar = isArray ? "]" : "}";
  let openCount = 0;
  let insideString = false;
  let escapeNext = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      insideString = !insideString;
      continue;
    }

    if (!insideString) {
      if (char === openChar) openCount++;
      else if (char === closeChar) openCount--;

      if (openCount === 0) {
        return text.substring(startIndex, i + 1);
      }
    }
  }
  return null;
}

function extractAllJsonObjects(text: string) {
  const results: any[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{" || text[i] === "[") {
      let j = i;
      let insideString = false;
      let escapeNext = false;
      let openCount = 0;
      const openChar = text[i];
      const closeChar = openChar === "{" ? "}" : "]";
      let found = false;

      for (; j < text.length; j++) {
        const char = text[j];
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        if (char === "\\") {
          escapeNext = true;
          continue;
        }
        if (char === '"') {
          insideString = !insideString;
          continue;
        }
        if (!insideString) {
          if (char === openChar) openCount++;
          else if (char === closeChar) openCount--;
          if (openCount === 0) {
            found = true;
            break;
          }
        }
      }

      if (found) {
        const jsonStr = text.substring(i, j + 1);
        if (
          jsonStr.length > 50 &&
          (jsonStr.includes('"role"') ||
            jsonStr.includes('"parts"') ||
            jsonStr.includes('"human"'))
        ) {
          try {
            results.push(JSON.parse(jsonStr));
          } catch (e) {}
        }
        i = j; // Skip the parsed object
      }
    }
  }
  return results;
}

function extractMessagesFromHtml(html: string) {
  const $ = cheerio.load(html);

  const messages: {
    role: string;
    content: string;
    timestamp?: string;
    imagesUrls?: string[];
  }[] = [];
  let title = $("title").text() || "Extracted Chat";
  let isDeadLink = false;
  let deadLinkMessage = "Could not extract structured messages from this HTML file.";

  const mapParts = (parts: any) => Array.isArray(parts) 
    ? parts.map((p: any) => typeof p === 'string' ? p : (p.text || p.text?.value || p.content || "")).filter(Boolean).join("\n") 
    : String(parts);

  // Check for known 404 or deleted chat signatures
  if (
    title.includes("404") || 
    title.includes("Unhandled Thrown Response") || 
    title.includes("Page not found") ||
    html.includes("Can't load shared conversation") ||
    html.includes("This conversation may have been deleted") ||
    html.includes("The conversation you requested could not be found")
  ) {
    isDeadLink = true;
    deadLinkMessage = "This ChatGPT share link is invalid, completely private, or has been deleted by the author.";
  }

  // Heuristics for different parsers

  // 1. Try to find __NEXT_DATA__ (old ChatGPT)
  const nextData = $("#__NEXT_DATA__").html();
  if (nextData) {
    try {
      const jsonData = JSON.parse(nextData);
      // Deep search for messages
      const searchMessages = (obj: any) => {
        if (!obj) return;
        if (Array.isArray(obj)) {
          obj.forEach(searchMessages);
        } else if (typeof obj === "object") {
          let timestamp: string | undefined = undefined;
          if (obj.create_time) {
            const ts =
              typeof obj.create_time === "number"
                ? obj.create_time
                : parseFloat(obj.create_time);
            if (!isNaN(ts))
              timestamp = new Date(ts > 1e11 ? ts : ts * 1000).toISOString();
          } else if (obj.createdAt || obj.created_at || obj.timestamp) {
            const ts = obj.createdAt || obj.created_at || obj.timestamp;
            if (typeof ts === "number")
              timestamp = new Date(ts > 1e11 ? ts : ts * 1000).toISOString();
            else timestamp = new Date(ts).toISOString();
          }
          if (timestamp === "Invalid Date") timestamp = undefined;

          if (
            obj.role &&
            obj.content &&
            typeof obj.content === "object" &&
            obj.content.parts
          ) {
            // ChatGPT API-like structure
            messages.push({
              role: obj.role,
              content: mapParts(obj.content.parts),
              timestamp,
            });
          } else {
            Object.values(obj).forEach(searchMessages);
          }
        }
      };
      searchMessages(jsonData);
    } catch (e) {
      console.error("Failed to parse __NEXT_DATA__", e);
    }
  }

  // Handle React Router streaming format (new ChatGPT format)
  if (messages.length === 0) {
    const scripts = $("script, style, noscript, nav, header, footer").map((_, el) => $(el).html()).get();
    for (const text of scripts) {
      if (text && (text.includes("streamController.enqueue") || text.includes("push("))) {
        const regex = /enqueue\(\s*new\s*Uint8Array\(\s*\[(.*?)]\s*\)\s*\)|enqueue\(\s*new\s*TextEncoder\(\)\.encode\(\s*"((?:[^"\\]|\\.)*)"\s*\)\s*\)|enqueue\(\s*"((?:[^"\\]|\\.)*)"\s*\)|push\(\s*(?:\[[^"\]]*"|")((?:[^"\\]|\\.)*)"(?:\s*\])?\s*\)/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
          try {
            let unescaped = '';
            if (match[1]) {
              const bytes = match[1].split(',').map(n => parseInt(n.trim(), 10));
              unescaped = Buffer.from(bytes).toString('utf-8');
            } else if (match[2]) {
              unescaped = match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            } else if (match[3]) {
              unescaped = match[3].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            } else if (match[4]) {
              unescaped = match[4].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            }
            if (unescaped) {
              // Try to find JSON inside the potentially escaped string
              const jsonMatch = unescaped.match(/(\{|\[)[\s\S]*(\}|\])/);
              const jsonToParse = jsonMatch ? jsonMatch[0] : unescaped;
              
              const jsonData = JSON.parse(jsonToParse);
              
              // search recursively just like __NEXT_DATA__
              const searchMessages = (obj: any) => {
                if (!obj) return;
                if (Array.isArray(obj)) {
                  obj.forEach(searchMessages);
                } else if (typeof obj === "object") {
                  if (
                    obj.role &&
                    obj.content &&
                    typeof obj.content.parts !== "undefined"
                  ) {
                    messages.push({
                       role: obj.role,
                       content: mapParts(obj.content.parts)
                    });
                  } else if (
                    obj.author &&
                    obj.author.role &&
                    obj.content &&
                    obj.content.parts
                  ) {
                    messages.push({
                       role: obj.author.role,
                       content: mapParts(obj.content.parts)
                    });
                  } else {
                    Object.values(obj).forEach(searchMessages);
                  }
                }
              };
              searchMessages(jsonData);
            }
          } catch (e) {
            // ignore parse errors for partial chunks
          }
        }
      }
    }
  }

  // 2. Try Remix Context or generic JSON in scripts
  if (messages.length === 0) {
    $("script").each((_, el) => {
      const text = $(el).html();
      if (!text) return;

      // Extract anything that looks like JSON or window.state assignments
      if (
        text.includes("__remixContext") ||
        text.includes("__INITIAL_STATE__") ||
        text.includes("human") ||
        text.includes("parts")
      ) {
        try {
          let parsed = null;

          // First try robust JSON extraction if there is an assignment
          if (text.includes("__remixContext")) {
            let jsonStr = extractJsonObject(text, "window.__remixContext =");
            if (!jsonStr) jsonStr = extractJsonObject(text, "__remixContext =");
            if (!jsonStr) jsonStr = extractJsonObject(text, "__remixContext=");
            if (jsonStr) parsed = JSON.parse(jsonStr);
          } else if (text.includes("__INITIAL_STATE__")) {
            let jsonStr = extractJsonObject(text, "window.__INITIAL_STATE__ =");
            if (!jsonStr)
              jsonStr = extractJsonObject(text, "__INITIAL_STATE__ =");
            if (!jsonStr)
              jsonStr = extractJsonObject(text, "__INITIAL_STATE__=");
            if (jsonStr) parsed = JSON.parse(jsonStr);
          }

          // Fallback to basic match if the robust extractor failed or prefix wasn't found
          if (!parsed) {
            const jsonList = extractAllJsonObjects(text);
            for (const jsonObj of jsonList) {
              // Try searching messages in each brute-force extracted json
              const searchMessages = (obj: any) => {
                if (!obj) return;
                if (Array.isArray(obj)) {
                  obj.forEach(searchMessages);
                } else if (typeof obj === "object") {
                  // ChatGPT API / Next.js / Remix pattern
                  if (
                    obj.author &&
                    obj.author.role &&
                    obj.content &&
                    obj.content.parts
                  ) {
                    messages.push({
                      role: obj.author.role,
                      content: mapParts(obj.content.parts),
                    });
                  }
                  // ChatGPT Alternative pattern
                  else if (
                    obj.role &&
                    obj.content &&
                    typeof obj.content === "object" &&
                    obj.content.parts
                  ) {
                    messages.push({
                      role: obj.role,
                      content: mapParts(obj.content.parts),
                    });
                  }
                  // Claude pattern
                  else if (
                    (obj.sender === "human" || obj.sender === "assistant") &&
                    obj.text
                  ) {
                    messages.push({
                      role: obj.sender === "human" ? "user" : "assistant",
                      content:
                        typeof obj.text === "string"
                          ? obj.text
                          : JSON.stringify(obj.text),
                    });
                  }
                  // Generic LLM pattern
                  else if (
                    typeof obj.role === "string" &&
                    (obj.role === "user" ||
                      obj.role === "assistant" ||
                      obj.role === "model") &&
                    typeof obj.content === "string"
                  ) {
                    messages.push({
                      role: obj.role === "model" ? "assistant" : obj.role,
                      content: obj.content,
                    });
                  }
                  // Continue deep search
                  else {
                    Object.values(obj).forEach(searchMessages);
                  }
                }
              };
              searchMessages(jsonObj);
            }
          } else {
            // Normal search if prefix extractor successfully parsed the structure
            const searchMessages = (obj: any) => {
              if (!obj) return;
              if (Array.isArray(obj)) {
                obj.forEach(searchMessages);
              } else if (typeof obj === "object") {
                let timestamp: string | undefined = undefined;
                if (obj.create_time) {
                  const ts =
                    typeof obj.create_time === "number"
                      ? obj.create_time
                      : parseFloat(obj.create_time);
                  if (!isNaN(ts))
                    timestamp = new Date(
                      ts > 1e11 ? ts : ts * 1000,
                    ).toISOString();
                } else if (obj.createdAt || obj.created_at || obj.timestamp) {
                  const ts = obj.createdAt || obj.created_at || obj.timestamp;
                  if (typeof ts === "number")
                    timestamp = new Date(
                      ts > 1e11 ? ts : ts * 1000,
                    ).toISOString();
                  else timestamp = new Date(ts).toISOString();
                }
                if (timestamp === "Invalid Date") timestamp = undefined;

                // ChatGPT API / Next.js / Remix pattern
                if (
                  obj.author &&
                  obj.author.role &&
                  obj.content &&
                  obj.content.parts
                ) {
                  messages.push({
                    role: obj.author.role,
                    content: mapParts(obj.content.parts),
                    timestamp,
                  });
                }
                // ChatGPT Alternative pattern
                else if (
                  obj.role &&
                  obj.content &&
                  typeof obj.content === "object" &&
                  obj.content.parts
                ) {
                  messages.push({
                    role: obj.role,
                    content: mapParts(obj.content.parts),
                    timestamp,
                  });
                }
                // Claude pattern
                else if (
                  (obj.sender === "human" || obj.sender === "assistant") &&
                  obj.text
                ) {
                  messages.push({
                    role: obj.sender === "human" ? "user" : "assistant",
                    content:
                      typeof obj.text === "string"
                        ? obj.text
                        : JSON.stringify(obj.text),
                    timestamp,
                  });
                }
                // Generic LLM pattern
                else if (
                  typeof obj.role === "string" &&
                  (obj.role === "user" ||
                    obj.role === "assistant" ||
                    obj.role === "model") &&
                  typeof obj.content === "string"
                ) {
                  messages.push({
                    role: obj.role === "model" ? "assistant" : obj.role,
                    content: obj.content,
                    timestamp,
                  });
                }
                // Continue deep search
                else {
                  Object.values(obj).forEach(searchMessages);
                }
              }
            };
            searchMessages(parsed);
          }
        } catch (e) {
          // Silently ignore parse errors for generic scripts
          // console.error(e);
        }
      }
    });
  }

  // 3. Regex Fallback: directly scan HTML text for ChatGPT signature patterns
  if (messages.length === 0) {
    const regex =
      /"role"\s*:\s*"([^"]+)"[^}]*"content_type"\s*:\s*"text"\s*,\s*"parts"\s*:\s*\[\s*"([\s\S]*?)"\s*\]/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      messages.push({
        role: match[1],
        // Basic unescape, although JSON.parse is better if possible
        content: match[2]
          .replace(/\\n/g, "\n")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\"),
      });
    }
  }

  // 4. Fallback to parsing DOM elements (Generic, Claude & ChatGPT)
  if (messages.length === 0) {
    const strictSelector =
      '[data-message-author-role], [data-testid="message"], article, .font-claude-message, .font-user-message, .message-row, .message-bubble, user-query, model-response, .user-query, .model-response, response-container, message-content, .chat-message';
    const genericSelector = ".message, .markdown, .prose, .ProseMirror";

    let messageNodes = $(strictSelector);
    let activeSelector = strictSelector;

    if (messageNodes.length === 0) {
      messageNodes = $(genericSelector);
      activeSelector = genericSelector;
    }

    // Filter out nested nodes
    const topLevelNodes: any[] = [];

    messageNodes.each((_, el) => {
      if (
        $(el).closest(
          'nav, aside, [class*="sidebar"]:not([class*="threadScrollVars"]), [class*="menu"], header, .drawer, .drawer-content, #onetrust-consent-sdk, [class*="onetrust"], [id*="onetrust"], [class*="cookie"], [id*="cookie"]',
        ).length > 0
      )
        return;
      let parent = el.parent;
      let isNested = false;
      while (parent && (parent.type as unknown as string) !== "root") {
        if ($(parent as any).is(activeSelector)) {
          isNested = true;
          break;
        }
        parent = parent.parent;
      }
      if (!isNested) {
        topLevelNodes.push(el);
      }
    });

    // Structural Fallback: If no standard chat message classes match, find the DOM node
    // with the most direct children that contain substantial text (likely the chat list container).
    if (topLevelNodes.length === 0) {
      let bestContainer: any = null;
      let maxScore = 0;

      $("body *").each((_, el) => {
        const $el = $(el);
        // Exclude text-heavy containers like markdown bodies from being selected as chat containers
        if ($el.is(".markdown, .prose, p, article:not([data-testid])")) return;

        let blockChildrenCount = 0;
        $el.children().each((_, child) => {
          const $child = $(child);
          const textLength = $child.text().trim().length;
          // Count children that are actual visible blocks with some text
          // Avoid treating simple paragraphs or headers as full messages
          if (
            textLength > 10 &&
            !$child.is(
              "script, style, noscript, nav, header, footer, p, h1, h2, h3, h4, h5, h6, ul, ol, li, span, a, strong, em, b, i, pre, code, blockquote",
            )
          ) {
            blockChildrenCount++;
          }
        });

        // A typical chat has at least a few messages. If we find a container with many structural blocks, it's a candidate.
        if (blockChildrenCount > maxScore && blockChildrenCount >= 2) {
          maxScore = blockChildrenCount;
          bestContainer = el;
        }
      });

      if (bestContainer) {
        $(bestContainer)
          .children()
          .each((_, child) => {
            const $child = $(child);
            if (
              $child.text().trim().length > 0 &&
              !$child.is("script, style, noscript, nav, header, footer")
            ) {
              topLevelNodes.push(child);
            }
          });
      }
    }

    if (topLevelNodes.length > 0) {
      $(topLevelNodes).each((_, el) => {
        const $el = $(el);
        let role = $el.attr("data-message-author-role");
        if (!role) {
          const childWithRole = $el.find("[data-message-author-role]").first();
          if (childWithRole.length > 0) {
            role = childWithRole.attr("data-message-author-role");
          }
        }
        if (!role) {
          const className = ($el.attr("class") || "").toLowerCase();
          const testId = ($el.attr("data-testid") || "").toLowerCase();
          const isUserClass =
            /(^|\s|-|_)(user|human|message-in|query|user-query)(\s|-|_|$)/i;
          const isAssistantClass =
            /(^|\s|-|_)(assistant|bot|ai|claude|message-out|model|model-response|gemini|chatgpt)(\s|-|_|$)/i;
          const cleanClassName = className
            .replace(/user-select/g, "")
            .replace(/select-none/g, "");

          // Check inner HTML or children if class doesn't help
          const innerHtml = $el.html() || "";
          const hasUserChild =
            innerHtml.includes("font-user-message") ||
            innerHtml.includes('data-message-author-role="user"') ||
            innerHtml.includes("user-query");
          const hasAssistantChild =
            innerHtml.includes("font-claude-message") ||
            innerHtml.includes('data-message-author-role="assistant"') ||
            innerHtml.includes("model-response") ||
            innerHtml.includes("response-content");

          const tagName = (
            $el.prop("tagName") ||
            (el as any).name ||
            (el as any).tagName ||
            ""
          ).toLowerCase();
          if (
            cleanClassName.includes("font-user-message") ||
            testId.includes("user") ||
            cleanClassName.match(isUserClass) ||
            hasUserChild ||
            tagName.includes("user-query")
          ) {
            role = "user";
          } else if (
            cleanClassName.includes("font-claude-message") ||
            testId.includes("assistant") ||
            cleanClassName.match(isAssistantClass) ||
            hasAssistantChild ||
            tagName.includes("model-response")
          ) {
            role = "assistant";
          } else {
            const textContent = $el.text() || "";
            if (textContent.match(/^\s*(You said|You|User):?/i)) {
              role = "user";
            } else if (
              textContent.match(
                /^\s*(ChatGPT|Claude|Gemini|Assistant|Grok|Bot|AI)( said)?:?/i,
              )
            ) {
              role = "assistant";
            } else {
              role = "unknown";
            }
          }
        }

        const timeEl = $el.closest("div, article, [data-testid]").find("time");
        const timestamp =
          timeEl.length > 0 ? timeEl.attr("datetime") : undefined;

        const $clone = $el.clone();
        $clone
          .find(
            'script, style, svg, noscript, nav, header, footer, button, [aria-hidden="true"], .sr-only, .visually-hidden, .cdk-visually-hidden, #onetrust-consent-sdk, [class*="onetrust"], [id*="onetrust"], [class*="cookie-banner"]',
          )
          .remove();
        
        // Specifically remove "Show more" / "Show less" text blocks
        $clone.find('*').each((_: any, el: any) => {
          const $child = $(el);
          // don't remove large blocks, only small elements that match exactly
          if ($child.children().length === 0) {
            const text = $child.text().trim();
            if (text === "Show more" || text === "Show less" || text === "Copy code" || text === "Show moreShow less") {
               $child.remove();
            }
          }
        });

        let content = "";
        try {
          content = turndownService.turndown($clone.html() || "");
        } catch (e) {
          content = convert($clone.html() || "", {
            wordwrap: false,
            selectors: [{ selector: "pre", format: "dataTable" }],
          });
        }
        content = content.replace(/Uploaded an image[\s\S]*?(?:$|\n)/gi, "");
        content = content.replace(/Show more[\s]*Show less/gi, "");
        content = content.replace(/Show more/gi, "");
        content = content.replace(/Show less/gi, "");
        content = content.replace(/(?:\b|^)Copy code\b/gi, "");
        content = content.replace(/([^\n])\n\*(?=\s)/g, "$1\n\n*"); // Fix turndown list missing blank line
        content = content.trim();

        const imgs = $el
          .find("img")
          .filter((_, img) => {
            const $img = $(img);
            const w = parseInt($img.attr("width") || "100", 10);
            const h = parseInt($img.attr("height") || "100", 10);
            const className = ($img.attr("class") || "").toLowerCase();
            if (w <= 36 || h <= 36) return false;
            if (
              className.includes("w-4") ||
              className.includes("w-5") ||
              className.includes("icon") ||
              className.includes("favicon") ||
              className.includes("logo")
            )
              return false;
            return true;
          })
          .map((_, img) => {
            let src = $(img).attr("src");
            if (src && src.includes("_next/image") && src.includes("url=")) {
              try {
                // Prepend dummy origin to parse URL properly if it's a relative URL
                const parsedUrl = new URL(src, "https://dummy.com");
                const urlParam = parsedUrl.searchParams.get("url");
                if (urlParam) {
                  src = urlParam.startsWith("http")
                    ? urlParam
                    : `https://chatgpt.com${urlParam.startsWith("/") ? "" : "/"}${urlParam}`;
                }
              } catch (e) {}
            }
            // If it's a relative URL (but not _next/image), we might want to make it absolute if from ChatGPT, but skip for now
            return src;
          })
          .get()
          .filter(
            (src) =>
              typeof src === "string" &&
              (src.startsWith("http") || src.startsWith("data:image")) &&
              !src.includes("avatar") &&
              !src.includes("profile"),
          ) as string[];

        const bgImgs = $el
          .find('[style*="background-image"]')
          .map((_, div) => {
            const style = $(div).attr("style");
            if (style) {
              const match = style.match(/url\(["']?(.*?)["']?\)/);
              return match ? match[1] : null;
            }
            return null;
          })
          .get()
          .filter(
            (src) =>
              typeof src === "string" &&
              (src.startsWith("http") || src.startsWith("data:image")),
          ) as string[];

        const allImgs = [...imgs, ...bgImgs].filter(
          (src) =>
            typeof src === "string" &&
            !src.toLowerCase().includes("avatar") &&
            !src.toLowerCase().includes("profile") &&
            !src.toLowerCase().includes("favicon") &&
            !src.toLowerCase().includes("icon") &&
            !src.toLowerCase().includes("logo") &&
            !src.toLowerCase().includes("brand"),
        );

        if (content.trim() || allImgs.length > 0) {
          messages.push({
            role,
            content: content.trim(),
            timestamp,
            imagesUrls: allImgs,
          });
        }
      });
    }

    if (messages.length === 0) {
      // Clean up body before absolute fallback
      const $clean = cheerio.load(html);
      $clean('script, style, noscript, nav, header, footer, button, [aria-hidden="true"], .sr-only, .visually-hidden, #onetrust-consent-sdk, [class*="onetrust"], [id*="onetrust"], [class*="cookie-banner"]').remove();
      
      $clean('*').each((_: any, el: any) => {
        const $child = $clean(el);
        if ($child.children().length === 0) {
          const text = $child.text().trim();
          if (text === "Show more" || text === "Show less" || text === "Copy code" || text === "Show moreShow less") {
             $child.remove();
          }
        }
      });

      // Absolute fallback: Just extract all text from the main container
      let main = $clean('main, .main, #content, [role="main"]').first();
      if (main.length === 0) main = $clean("body");

      let content = "";
      try {
        content = turndownService.turndown(main.html() || "");
      } catch (e) {
        content = convert(main.html() || "", { wordwrap: false });
      }

      // Ignore "cookie preferences" or footer boilerplate
      const cleanedContent = content
        .replace(/This is a copy of a shared ChatGPT conversation[\s\S]*?Cookie Preferences\./gi, "")
        .replace(/ChatGPT can make mistakes\. Check important info\./gi, "")
        .replace(/Report conversation/gi, "")
        .replace(/_._oai_[\s\S]*?\(\)/g, "") // Specific junk removal
        .replace(/\{[\s\S]*?\}/g, "") // Remove likely JS objects if they leaked as text
        .replace(/window.*?oai_logHTML[\s\S]*?Date\.now\(\)(?:\}\)|\})/g, "") // new ChatGPT fallback JS junk
        .replace(/window.*?oai_SSR[\s\S]*?(?:Date\.now|requestAnimationFrame)[\s\S]*?\)\}\)/g, "") // new ChatGPT fallback JS junk
        .replace(/window\.\\_\\_oai[^\s]*/g, "") // escaped versions
        .replace(/window\.\.\\.oai[^\s]*/g, "") // markdown escaped version
        .replace(/This is a copy of a shared.*?(?:Date\.now\(\)\}\)|Date\.now\(\)\)\})/gi, "") // Aggressive wipe of frontmatter
        .replace(/Uploaded an image[\s\S]*?(?:$|\n)/gi, "")
        .replace(/Show more[\s]*Show less/gi, "")
        .replace(/Show more/gi, "")
        .replace(/Show less/gi, "")
        .replace(/(?:\b|^)Copy code\b/gi, "")
        .replace(/([^\n])\n\*(?=\s)/g, "$1\n\n*") // Fix turndown list bug
        .trim();

      // If the content is literally just the fallback junk that got past the regexes, drop it
      if (cleanedContent.includes("oai_logHTML") || cleanedContent.includes("oai_SSR_HTML") || /Date\.now\(\)/.test(cleanedContent) || cleanedContent.includes("requestAnimationFrame")) {
         // It's just junk script data, skip fallback
      } else if (cleanedContent.length > 50 && !cleanedContent.includes("_._oai_")) {
        // Check if this looks like a generic transcript dump with "SOMEONE SAID:" markers
        const splitRegex =
          /\n?(?:(?:[A-Za-z0-9_ ]+) )?([A-Za-z0-9_]+) SAID:\n/gi;
        
        let hasMarkers = splitRegex.test(cleanedContent);
        let activeRegex = splitRegex;
        
        if (!hasMarkers) {
           // check for "You said:" pattern
           const youSaidRegex = /\n?(?:([A-Za-z0-9_ ]+) said:\n)/gi;
           if (youSaidRegex.test(cleanedContent)) {
             hasMarkers = true;
             activeRegex = youSaidRegex;
           }
        }

        if (hasMarkers) {
          // Reset lastIndex because test() modifies it
          activeRegex.lastIndex = 0;
          const parts = cleanedContent.split(activeRegex);
          // parts[0] is intro string
          for (let i = 1; i < parts.length; i += 2) {
            const speaker = parts[i] || "";
            const text = parts[i + 1] || "";
            if (!text.trim()) continue;

            let currentRole = "user";
            if (speaker.match(/chatgpt|claude|gemini|assistant|bot|ai|grok/i)) {
              currentRole = "assistant";
            }
            messages.push({
              role: currentRole,
              content: text.trim(),
            });
          }
        } else {
          // Check for pure markdown headers alternating
          const headerRegex = /\n?(?:#+ |!# )?(User|ChatGPT|Assistant|Claude|Copilot)\s*\n/gi;
          if (headerRegex.test(cleanedContent)) {
             headerRegex.lastIndex = 0;
             const parts = cleanedContent.split(headerRegex);
             for (let i = 1; i < parts.length; i += 2) {
               const speaker = parts[i] || "";
               const text = parts[i + 1] || "";
               if (!text.trim()) continue;
               
               let currentRole = "user";
               if (speaker.match(/chatgpt|claude|gemini|assistant|bot|ai|grok/i)) {
                 currentRole = "assistant";
               }
               messages.push({
                 role: currentRole,
                 content: text.trim()
               });
             }
          } else {
            // Split by double newlines and assign alternating roles if it looks like a block of messages
            const blocks = cleanedContent.split(/\n\n+/).map((b) => b.trim()).filter((b) => b.length > 0);
            if (blocks.length > 1 && blocks.length < 100) {
               let isUser = true;
               for (const block of blocks) {
                  messages.push({
                     role: isUser ? "user" : "assistant",
                     content: block
                  });
                  isUser = !isUser;
               }
            } else {
              messages.push({
                role: "unknown",
                content: cleanedContent,
              });
            }
          }
        }
      }
    }
  }

  if (messages.length === 0) {
    return { title, messages: [], isDeadLink, deadLinkMessage };
  }

  console.log("Extracted messages length:", messages.length);
  // Remove boilerplate/disclaimer messages
  let filteredMessages = messages.filter(
    (msg) => {
      const c = msg.content;
      const isBoilerplate = 
        (c.includes("This is a copy of a chat between") && c.includes("Anthropic")) ||
        (c.includes("This is a copy of a shared ChatGPT conversation")) ||
        (c.includes("_._oai_") && c.includes("window.")) ||
        (c.includes("oai_logHTML")) ||
        (c.includes("oai_SSR")) ||
        (c.includes("requestAnimationFrame")) ||
        (c.trim() === "ChatGPT can make mistakes. Check important info.") ||
        (c.trim() === "Report conversation") ||
        (c.trim() === "Cookie Preferences");
      return !isBoilerplate;
    }
  );

  const isGrok =
    title.toLowerCase().includes("grok") ||
    html.toLowerCase().includes("grok.com");

  // Second pass to resolve remaining unknown roles using flip-flop logic
  let isUser = true;
  for (const msg of filteredMessages) {
    if (isGrok) {
      // Force strict alternation for Grok due to obfuscated classes causing false-positives
      msg.role = isUser ? "user" : "assistant";
      isUser = !isUser;
    } else if (!msg.role || msg.role === "unknown") {
      msg.role = isUser ? "user" : "assistant";
      isUser = !isUser; // Toggle for the next unknown message
    } else {
      isUser = msg.role !== "user"; // keep alternating correctly based on latest explicit role
    }
  }

  // Deduplicate adjacent messages with the exact same content
  const deduplicatedMessages = filteredMessages.filter((msg, idx) => {
    if (idx === 0) return true;
    const prevMsg = filteredMessages[idx - 1];
    return (
      msg.content.trim() !== prevMsg.content.trim() || msg.role !== prevMsg.role
    );
  });

  return { title, messages: deduplicatedMessages, isDeadLink, deadLinkMessage };
}

async function startServer() {
  const isDev = process.env.NODE_ENV === "development" || (!process.env.NODE_ENV && process.argv[1] && process.argv[1].endsWith('server.ts'));
  if (isDev) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    const address = server.address();
    console.log(`Server running on ${typeof address === 'string' ? address : `http://${address?.address}:${address?.port}`}`);
  });
}

startServer();

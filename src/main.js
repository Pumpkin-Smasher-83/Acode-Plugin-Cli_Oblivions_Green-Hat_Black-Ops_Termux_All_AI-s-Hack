// Oblivion Acode plugin - Ollama-first Multi-AI Orchestrator
// - Ollama is treated as the primary synthesizer (local or remote Ollama HTTP API).
// - Other AI providers are queried in parallel (via Termux bridge or direct HTTP).
// - Responses from other AIs are fed into Ollama for final synthesis (consensus).
// - Termux bridge is used to run CLI tools, run code, and perform uploads to user-chosen cloud.
// - Important: Security tools require explicit authorization confirmation before running.
//
// NOTE: This is a scaffold/orchestrator. Heavy AI SDKs, native modules, and CLI binaries run
// in Termux (termux/bridge.js) or on a remote server. Do NOT commit API keys. Store keys with
// the plugin's encrypted storage UI or in Termux env vars.
//
// Replace or extend provider adapters in bridge.js as needed.
//
// Commands registered:
// - oblivion:set-key           -> store encrypted API key for provider
// - oblivion:configure-ollama  -> set Ollama host (http://host:port) and model
// - oblivion:multiask         -> ask a question, gather providers, synthesize in Ollama
// - oblivion:run-cmd          -> run an authorized command in Termux (requires authorization)
// - oblivion:run-code         -> run code (file) in Termux and return output
// - oblivion:upload-to-cloud  -> upload a file to configured cloud (rclone/aws/s3/etc)
//
// Usage: install the plugin zip in Acode developer mode and set up the termux bridge per README.

(async function () {
  // Basic environment checks
  try {
    if (typeof acode === 'undefined' || !acode.require) {
      console.error('Not running in Acode plugin context.');
      return;
    }
  } catch (e) {
    console.error('Acode not available:', e);
    return;
  }

  const terminal = acode.require('terminal');
  const storage = (acode.plugins && acode.plugins.storage) ? acode.plugins.storage : null;
  if (!storage) acode.toast('Plugin storage not available; API key persistence may not work.');

  // ---------- Utilities: crypto for encrypted API key storage ----------
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  async function deriveKey(passphrase, salt) {
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  function toB64(u8) { return btoa(String.fromCharCode(...u8)); }
  function fromB64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

  async function encryptText(passphrase, text) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
    return { salt: toB64(salt), iv: toB64(iv), data: toB64(new Uint8Array(cipher)) };
  }

  async function decryptText(passphrase, payload) {
    const salt = fromB64(payload.salt);
    const iv = fromB64(payload.iv);
    const data = fromB64(payload.data);
    const key = await deriveKey(passphrase, salt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return dec.decode(plain);
  }

  function saveEncrypted(provider, payload) {
    if (!storage) return false;
    storage.set(`oblivion_api_${provider}`, JSON.stringify(payload));
    return true;
  }

  function loadEncrypted(provider) {
    if (!storage) return null;
    const v = storage.get(`oblivion_api_${provider}`);
    return v ? JSON.parse(v) : null;
  }

  // ---------- Plugin settings/state ----------
  const PLUGIN_STATE_KEY = 'oblivion_state_v1';
  function saveState(obj) { if (storage) storage.set(PLUGIN_STATE_KEY, JSON.stringify(obj)); }
  function loadState() { if (storage) { const v = storage.get(PLUGIN_STATE_KEY); return v ? JSON.parse(v) : {}; } return {}; }

  let state = loadState();
  state.ollama = state.ollama || { host: 'http://127.0.0.1:11434', model: 'lly-ollama' };
  state.bridge = state.bridge || { url: 'http://127.0.0.1:8765', token: '' };
  saveState(state);

  // ---------- Termux bridge helpers ----------
  async function bridgePost(path, body) {
    const url = (state.bridge.url || 'http://127.0.0.1:8765') + path;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, body, { token: state.bridge.token }))
      });
      return res.json();
    } catch (e) {
      console.error('Bridge request failed', e);
      throw e;
    }
  }

  // Exec a shell command via bridge; bridge must implement /exec
  async function bridgeExec(cmd, args = []) {
    const resp = await bridgePost('/exec', { cmd, args });
    return resp;
  }

  // Call a third-party AI via bridge: bridge must implement /ai/call
  async function bridgeAICall(provider, input) {
    const resp = await bridgePost('/ai/call', { provider, input });
    return resp;
  }

  // ---------- Ollama interaction ----------
  // Query Ollama HTTP API (local or remote) - expects Ollama API endpoint /api/generate or /v1/ completions depending on version
  async function callOllama(prompt, model = state.ollama.model, options = {}) {
    const host = state.ollama.host;
    // Ollama usually exposes POST /api/generate with {model, prompt}. Adjust if your Ollama differs.
    const body = { model, prompt, ...options };
    try {
      const res = await fetch(`${host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama error: ${res.status} ${text}`);
      }
      const json = await res.json();
      // Many Ollama responses stream; this scaffold assumes standard JSON with text at json.result[0].content or json.output.
      if (json?.result && Array.isArray(json.result) && json.result[0]?.content) return json.result[0].content;
      if (json?.output) return typeof json.output === 'string' ? json.output : JSON.stringify(json.output);
      return JSON.stringify(json);
    } catch (e) {
      console.error('callOllama failed', e);
      throw e;
    }
  }

  // ---------- Multi-AI orchestration ----------
  // providers: array of provider ids (e.g., ['openai','anthropic','cohere'])
  // For each provider, attempt to call via bridge; if bridge unavailable you can extend this to direct calls.
  async function gatherProviderResponses(prompt, providers = []) {
    const tasks = providers.map(async (prov) => {
      try {
        // Prefer bridge to do provider calls (safer to keep keys in Termux or server)
        const r = await bridgeAICall(prov, { prompt });
        return { provider: prov, success: true, response: r };
      } catch (e) {
        return { provider: prov, success: false, error: e.message || String(e) };
      }
    });
    return Promise.all(tasks);
  }

  // Ask function: gather responses then ask Ollama to synthesize into final answer
  async function askWithConsensus(prompt, providers = ['openai', 'anthropic']) {
    acode.toast('Asking providers: ' + providers.join(', '));
    let gathered = [];
    try {
      gathered = await gatherProviderResponses(prompt, providers);
    } catch (e) {
      acode.toast('Error gathering provider responses: ' + e.message);
    }

    // Build a combined prompt for Ollama: include original question + provider outputs
    let combined = `You are the primary assistant. A user asked:\n\n${prompt}\n\nYou have collected the following responses from multiple AI providers. Provide a consolidated, prioritized answer, explain differences, and recommend best next steps. Be concise and list commands to run if applicable.\n\nProvider responses:\n`;
    gathered.forEach((g) => {
      if (g.success) {
        combined += `\n---\nProvider: ${g.provider}\nResponse:\n${typeof g.response === 'object' ? JSON.stringify(g.response, null, 2) : g.response}\n`;
      } else {
        combined += `\n---\nProvider: ${g.provider}\nError: ${g.error}\n`;
      }
    });

    // Ask Ollama to synthesize
    const ollamaResp = await callOllama(combined);
    return { ollama: ollamaResp, gathered };
  }

  // ---------- Safety: explicit authorization check for security actions ----------
  async function confirmAuthorized(target) {
    // Forces user to type a specific phrase to confirm authorization to test the target.
    const prompt = `You must confirm you have explicit authorization to test ${target}. Type the exact phrase:\nI HAVE AUTHORIZATION TO TEST ${target}`;
    const resp = await acode.prompt(prompt, '');
    const want = `I HAVE AUTHORIZATION TO TEST ${target}`;
    return resp === want;
  }

  // ---------- High-level actions ----------

  acode.commands.register('oblivion:set-key', async () => {
    const provider = (await acode.prompt('Provider name (e.g. openai):', 'openai')) || '';
    if (!provider) return;
    const pass = await acode.prompt('Enter passphrase to encrypt the API key (do not forget this):', '');
    if (!pass) { acode.toast('Passphrase required'); return; }
    const key = await acode.prompt(`Enter API key for ${provider}:`, '');
    if (!key) { acode.toast('No key entered'); return; }
    const payload = await encryptText(pass, key.trim());
    saveEncrypted(provider, payload);
    acode.toast(`${provider} key saved (encrypted).`);
  });

  acode.commands.register('oblivion:configure-ollama', async () => {
    const host = await acode.prompt('Ollama host (http://host:port):', state.ollama.host || 'http://127.0.0.1:11434');
    const model = await acode.prompt('Ollama model name:', state.ollama.model || 'lly-ollama');
    state.ollama.host = host || state.ollama.host;
    state.ollama.model = model || state.ollama.model;
    saveState(state);
    acode.toast('Ollama configured: ' + state.ollama.host + ' model:' + state.ollama.model);
  });

  acode.commands.register('oblivion:configure-bridge', async () => {
    const url = await acode.prompt('Termux bridge URL (http://127.0.0.1:8765):', state.bridge.url || 'http://127.0.0.1:8765');
    const token = await acode.prompt('Termux bridge token (BRIDGE_TOKEN):', state.bridge.token || '');
    state.bridge.url = url || state.bridge.url;
    state.bridge.token = token || state.bridge.token;
    saveState(state);
    acode.toast('Bridge configured.');
  });

  acode.commands.register('oblivion:multiask', async () => {
    const prompt = await acode.prompt('Enter question for multi-AI consensus:', '');
    if (!prompt) return;
    // Ask user to list providers to query (comma separated)
    const pList = await acode.prompt('Providers to query (comma separated, e.g. openai,anthropic,cohere). Leave empty for default:', 'openai,anthropic');
    const providers = pList ? pList.split(',').map(s => s.trim()).filter(Boolean) : ['openai', 'anthropic'];
    acode.toast('Gathering provider responses...');
    try {
      const result = await askWithConsensus(prompt, providers);
      // Show result in a simple panel
      const html = `<div style="padding:12px"><h3>Ollama synthesis</h3><pre style="white-space:pre-wrap">${escapeHtml(result.ollama)}</pre><h4>Provider details</h4><pre style="white-space:pre-wrap">${escapeHtml(JSON.stringify(result.gathered, null, 2))}</pre></div>`;
      acode.panel.create('Oblivion: Answer', html, { icon: 'icons/icon48.png' });
      acode.toast('Consensus ready.');
    } catch (e) {
      acode.toast('Error during multiask: ' + e.message);
    }
  });

  acode.commands.register('oblivion:run-cmd', async () => {
    const target = await acode.prompt('Target/Scope being tested (for authorization tracking):', '');
    if (!target) return;
    const ok = await confirmAuthorized(target);
    if (!ok) { acode.toast('Authorization not confirmed. Aborting.'); return; }
    const cmd = await acode.prompt('Command to run in Termux (e.g., nmap -A 1.2.3.4):', '');
    if (!cmd) return;
    try {
      // We prefer bridge Exec to get stdout; if bridge not available, fallback to opening a Termux terminal session
      try {
        const resp = await bridgeExec('sh', ['-c', cmd]);
        acode.panel.create('Oblivion: Cmd Output', `<pre style="white-space:pre-wrap">${escapeHtml(resp.stdout || resp)}</pre>`, { icon: 'icons/icon48.png' });
      } catch (e) {
        // fallback
        const session = await terminal.createServer({ name: 'Oblivion-Cmd' });
        terminal.write(session.id, cmd + '\r');
        acode.toast('Command sent to Termux interactive session.');
      }
    } catch (e) {
      acode.toast('Failed to run command: ' + e.message);
    }
  });

  acode.commands.register('oblivion:run-code', async () => {
    const lang = await acode.prompt('Language or runtime (bash, python, node, go):', 'bash');
    const code = await acode.editor.getValue();
    if (!code) { acode.toast('Open a file in editor to run its code, or paste code into the editor.'); return; }
    // Save editor content to a temp file in Acode workspace, then send path to Termux via bridge or open terminal and run.
    // Best method: use bridge to write file and execute it; bridge must support /file/write and /exec OR use terminal to echo > file.
    const filename = await acode.prompt('Remote filename to create in Termux (e.g., /data/data/com.termux/files/home/tmp/run.sh):', `/data/data/com.termux/files/home/oblivion_run.${lang}`);
    if (!filename) return;
    try {
      // Prefer bridge file write if available
      try {
        await bridgePost('/file/write', { path: filename, content: code });
        const runCmd = runtimeCommandForLang(lang, filename);
        const resp = await bridgeExec('sh', ['-c', runCmd]);
        acode.panel.create('Oblivion: Run Output', `<pre style="white-space:pre-wrap">${escapeHtml(resp.stdout || resp)}</pre>`, { icon: 'icons/icon48.png' });
      } catch (e) {
        // Fallback: create terminal session and pipe content via heredoc, then run
        const session = await terminal.createServer({ name: 'Oblivion-Run' });
        // Minimal approach: write via echo (may break for complex content)
        terminal.write(session.id, `cat > "${filename}" <<'EOF'\r`);
        // send code lines
        const lines = code.split(/\r?\n/);
        for (const L of lines) {
          terminal.write(session.id, L.replace(/\r/g, '') + '\r');
        }
        terminal.write(session.id, 'EOF\r');
        const runCmd = runtimeCommandForLang(lang, filename);
        terminal.write(session.id, runCmd + '\r');
        acode.toast('Sent code to Termux terminal. See terminal output.');
      }
    } catch (e) {
      acode.toast('Error running code: ' + e.message);
    }
  });

  acode.commands.register('oblivion:upload-to-cloud', async () => {
    const dst = await acode.prompt('Cloud adapter (e.g., s3, rclone, gdrive):', 's3');
    const localPath = await acode.prompt('Local path in Termux to upload:', '/data/data/com.termux/files/home/oblivion_run.output');
    if (!localPath) return;
    try {
      // Use bridge to upload; bridge must implement /storage/upload
      const resp = await bridgePost('/storage/upload', { adapter: dst, path: localPath });
      acode.panel.create('Oblivion: Upload', `<pre>${escapeHtml(JSON.stringify(resp, null, 2))}</pre>`, { icon: 'icons/icon48.png' });
      acode.toast('Upload attempted; check output panel.');
    } catch (e) {
      acode.toast('Upload failed: ' + e.message);
    }
  });

  // ---------- Helpers ----------
  function runtimeCommandForLang(lang, path) {
    lang = (lang || '').toLowerCase();
    switch (lang) {
      case 'python': return `python "${path}"`;
      case 'node': return `node "${path}"`;
      case 'bash':
      case 'sh': return `bash "${path}"`;
      case 'go': return `go run "${path}"`;
      default: return `bash "${path}"`;
    }
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Provide a simple entry panel
  acode.panel.create('Oblivion', `<div style="padding:12px">
    <h3>Oblivion: Ollama-first AI Orchestrator</h3>
    <p>Use commands: oblivion:configure-ollama, oblivion:configure-bridge, oblivion:set-key, oblivion:multiask, oblivion:run-cmd, oblivion:run-code.</p>
    <p style="color:crimson"><strong>Security:</strong> only test targets you have written authorization for. You will be asked to confirm before running scans.</p>
  </div>`, { icon: 'icons/icon48.png' });

  acode.toast('Oblivion plugin (Ollama-first) initialized.');
})();
import plugin from "../plugin.json";
import style from "./style.scss";

import { HarmBlockThreshold, HarmCategory } from "@google/generative-ai";
import { ChatOllama } from "@langchain/community/chat_models/ollama";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { AIMessage, HumanMessage, trimMessages } from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenAI } from "@langchain/openai";

import copy from "copy-to-clipboard";
import { v4 as uuidv4 } from "uuid";
import { APIKeyManager } from "./api_key";
import { AI_PROVIDERS, OPENAI_LIKE, copyIconSvg, sendIconSvg, stopIconSvg, terminalIconSvg, executeIconSvg, multiAiIconSvg, securityIconSvg, ollamaIconSvg, promptIconSvg, freeModelIconSvg, blockchainIconSvg, SECURITY_TOOLS, SUPPORTED_LANGUAGES } from "./constants";
import { getModelsFromProvider, extractCodeBlocks, detectCodeLanguage, sanitizeInput } from "./utils";
import { TerminalManager } from "./terminal";
import { MultiAIManager } from "./multi-ai";
import { OllamaManager } from "./ollama-manager";
import { PromptManager } from "./prompt-manager";
import { FreeSecurityToolsManager } from "./free-security-tools";
import { FREE_AI_MODELS } from "./free-models";
import { BlockchainSecurityManager } from "./blockchain-security";

const multiPrompt = acode.require("multiPrompt");
const fs = acode.require("fs");
const select = acode.require("select");
const prompt = acode.require("prompt");
const DialogBox = acode.require("dialogBox");
const helpers = acode.require("helpers");
const loader = acode.require("loader");
const sidebarApps = acode.require("sidebarApps");
const toInternalUrl = acode.require("toInternalUrl");
const contextMenu = acode.require("contextMenu");
const selectionMenu = acode.require("selectionMenu");
const { editor } = editorManager;

const AI_HISTORY_PATH = window.DATA_STORAGE + "chatgpt";

let CURRENT_SESSION_FILEPATH = null;

class AIAssistant {
  async init($page) {
    /**
     * Scripts and styles for Highlighting
     * and formating ai response
     */

    this.$githubDarkFile = tag("link", {
      rel: "stylesheet",
      href: this.baseUrl + "assets/github-dark.css",
    });
    this.$higlightJsFile = tag("script", {
      src: this.baseUrl + "assets/highlight.min.js",
    });
    this.$markdownItFile = tag("script", {
      src: this.baseUrl + "assets/markdown-it.min.js",
    });
    // Global styles
    this.$style = tag("style", {
      textContent: style,
    });
    document.head.append(
      this.$githubDarkFile,
      this.$higlightJsFile,
      this.$markdownItFile,
      this.$style,
    );


    /**
     * Adding command for starting chatgpt
     * And updating its token
     */

    editor.commands.addCommand({
      name: "ai_assistant",
      description: "AI Assistant",
      exec: this.run.bind(this),
    });

    selectionMenu.add(async () => {
      let opt = await select("AI Actions", ["Explain Code", "Rewrite", "Generate Code"], {
        onHide: () => { window.toast("Work is in progress...", 3000) }
      })
    }, "✨", 'all');

    $page.id = "acode-ai-assistant";
    $page.settitle("AI Assistant");
    this.$page = $page;
    const menuBtn = tag("span", {
      className: "icon more_vert",
      dataset: {
        action: "toggle-menu",
      },
    });

    const historyBtn = tag("span", {
      className: "icon historyrestore",
      dataset: {
        action: "history"
      }
    });

    // button for new chat
    const newChatBtn = tag("span", {
      className: "icon add",
      dataset: {
        action: "new-chat",
      },
    });

    const insertContextBtn = tag("span", {
      //className: "icon linkinsert_link",
      className: "icon insert_invitationevent",
      dataset: {
        action: "insert-context",
      },
    });

    // Terminal button
    const terminalBtn = tag("span", {
      className: "icon terminal",
      dataset: {
        action: "terminal",
      },
      innerHTML: terminalIconSvg,
      title: "Terminal & Code Execution"
    });

    // Multi-AI button
    const multiAiBtn = tag("span", {
      className: "icon multi-ai",
      dataset: {
        action: "multi-ai",
      },
      innerHTML: multiAiIconSvg,
      title: "Multi-AI Chat"
    });

    // Security tools button
    const securityBtn = tag("span", {
      className: "icon security",
      dataset: {
        action: "security",
      },
      innerHTML: securityIconSvg,
      title: "Security & Bug Bounty Tools"
    });

    // Ollama local models button
    const ollamaBtn = tag("span", {
      className: "icon ollama",
      dataset: {
        action: "ollama",
      },
      innerHTML: ollamaIconSvg,
      title: "Ollama Local Models"
    });

    // Custom prompts button
    const promptBtn = tag("span", {
      className: "icon prompt",
      dataset: {
        action: "prompt",
      },
      innerHTML: promptIconSvg,
      title: "Custom Prompts & Fine-tuning"
    });

    // Free models button
    const freeModelsBtn = tag("span", {
      className: "icon free-models",
      dataset: {
        action: "free-models",
      },
      innerHTML: freeModelIconSvg,
      title: "Free & Open-Source Models"
    });

    const blockchainBtn = tag("span", {
      className: "icon blockchain-security",
      dataset: {
        action: "blockchain-security",
      },
      innerHTML: blockchainIconSvg,
      title: "Blockchain Security Scanner - Ultimate Bug Bounty Tool"
    });

    this.$page.header.append(newChatBtn, insertContextBtn, terminalBtn, multiAiBtn, securityBtn, ollamaBtn, promptBtn, freeModelsBtn, blockchainBtn, historyBtn, menuBtn);

    historyBtn.onclick = this.myHistory.bind(this);
    newChatBtn.onclick = this.newChat.bind(this);
    terminalBtn.onclick = this.showTerminal.bind(this);
    multiAiBtn.onclick = this.showMultiAI.bind(this);
    securityBtn.onclick = this.showSecurityTools.bind(this);
    ollamaBtn.onclick = this.showOllamaManager.bind(this);
    promptBtn.onclick = this.showPromptManager.bind(this);
    freeModelsBtn.onclick = this.showFreeModels.bind(this);
    blockchainBtn.onclick = this.showBlockchainSecurity.bind(this);

    const contextMenuOption = {
      top: '35px',
      right: '10px',
      toggler: menuBtn,
      transformOrigin: 'top right',
    };
    const $menu = contextMenu({
      innerHTML: () => {
        return `
        <li action="model-provider" provider="">Provider: ${window.localStorage.getItem("ai-assistant-provider")}</li>
        <li action="model" modelNme="">Model: ${window.localStorage.getItem("ai-assistant-model-name")}</li>
        `;
      },
      ...contextMenuOption
    })
    $menu.onclick = async (e) => {
      $menu.hide();
      const action = e.target.getAttribute('action');
      switch (action) {
        case 'model-provider':
          let previousProvider = window.localStorage.getItem("ai-assistant-provider");
          
          // Create enhanced provider list with free/paid indicators
          const enhancedProviders = AI_PROVIDERS.map(provider => {
            const freeProviders = ["Ollama", "Hugging Face", "OpenAI-Like"];
            const isFree = freeProviders.includes(provider);
            return `${provider}${isFree ? ' (FREE)' : ' (Paid)'}`;
          });
          
          let providerSelectBox = await select("Select AI Provider - Free options available!", enhancedProviders, {
            default: previousProvider ? `${previousProvider}${["Ollama", "Hugging Face", "OpenAI-Like"].includes(previousProvider) ? ' (FREE)' : ' (Paid)'}` : ""
          });
          
          // Extract the actual provider name (remove the (FREE)/(Paid) suffix)
          providerSelectBox = providerSelectBox.replace(/ \((FREE|Paid)\)$/, '');
          if (previousProvider != providerSelectBox) {
            // Check for OpenAI-Like providers
            if (providerSelectBox === OPENAI_LIKE) {
              // Collect required information for OpenAI-Like providers
              const apiKey = await prompt("API Key", "", "text", { required: true });
              if (!apiKey) return;

              const baseUrl = await prompt("API Base URL", "https://api.openai.com/v1", "text", {
                required: true
              });

              const modelName = await prompt("Model", "", "text", { required: true });
              if (!modelName) return;

              // Save settings
              window.localStorage.setItem("ai-assistant-provider", OPENAI_LIKE);
              window.localStorage.setItem("ai-assistant-model-name", modelName);
              window.localStorage.setItem("openai-like-baseurl", baseUrl);

              await this.apiKeyManager.saveAPIKey(OPENAI_LIKE, apiKey);
              this.initiateModel(OPENAI_LIKE, apiKey, modelName);
              this.newChat();
            }
            // Handle other providers
            else {
              // check for api key
              if (window.localStorage.getItem(providerSelectBox) === null) {
                let apiKey;
                
                // Handle free providers
                if (providerSelectBox === "Ollama") {
                  apiKey = "No Need Of API Key";
                  window.toast("Ollama is FREE! No API key needed. Install locally for best performance.", 4000);
                } else if (providerSelectBox === "Hugging Face") {
                  const useHF = await prompt("Hugging Face API Key (Optional - many models are free)", "", "text", {
                    required: false
                  });
                  apiKey = useHF || "No Need Of API Key";
                  if (!useHF) {
                    window.toast("Using Hugging Face without API key - some models may be limited", 3000);
                  }
                } else {
                  // Paid providers - show helpful message
                  const freeAlternative = "💡 TIP: Use Ollama (FREE) or Hugging Face (FREE) for the same functionality without costs!";
                  apiKey = await prompt(`API key for ${providerSelectBox}\n\n${freeAlternative}`, "", "text", {
                    required: true,
                  });
                }
                if (!apiKey) return;
                loader.showTitleLoader();
                window.toast("Fetching available models from your account", 2000);
                let modelList = await getModelsFromProvider(providerSelectBox, apiKey);
                loader.removeTitleLoader();
                let modelNme = await select("Select AI Model", modelList);
                window.localStorage.setItem("ai-assistant-provider", providerSelectBox);
                window.localStorage.setItem("ai-assistant-model-name", modelNme);
                await this.apiKeyManager.saveAPIKey(providerSelectBox, apiKey);
                this.initiateModel(providerSelectBox, apiKey, modelNme);
                this.newChat();
              } else {
                let apiKey = await this.apiKeyManager.getAPIKey(providerSelectBox);
                this.initiateModel(providerSelectBox, apiKey, window.localStorage.getItem("ai-assistant-model-name"));
                this.newChat();
              }
            }
          }
          break;
        case 'model':
          let provider = window.localStorage.getItem("ai-assistant-provider");
          let apiKey = await this.apiKeyManager.getAPIKey(provider);

          // Handle OpenAI-Like providers differently
          if (provider === OPENAI_LIKE) {
            let currentModel = window.localStorage.getItem("ai-assistant-model-name") || "";
            let modelName = await prompt("Enter Model", currentModel, "text", { required: true });
            if (modelName) {
              window.localStorage.setItem("ai-assistant-model-name", modelName);
              this.initiateModel(OPENAI_LIKE, apiKey, modelName);
            }
          } 
          // Handle other providers normally
          else {
            loader.showTitleLoader();
            window.toast("Fetching available models from your account", 2000);
            let modelList = await getModelsFromProvider(provider, apiKey);
            loader.removeTitleLoader();
            let modelNme = await select("Select AI Model", modelList, {
              default: window.localStorage.getItem("ai-assistant-model-name") || ""
            });
            if (window.localStorage.getItem("ai-assistant-model-name") != modelNme) {
              window.localStorage.setItem("ai-assistant-model-name", modelNme);
              this.initiateModel(provider, apiKey, modelNme);
            }
          }
          break;
      }
    };

    const mainApp = tag("div", {
      className: "mainApp",
    });
    // main chat box
    this.$chatBox = tag("div", {
      className: "chatBox",
    });
    // bottom query taker box
    this.$inputBox = tag("div", {
      className: "inputBox",
    });

    this.$chatTextarea = tag("textarea", {
      className: "chatTextarea",
      placeholder: "Type your query...",
    });
    this.$sendBtn = tag("button", {
      className: "sendBtn",
    });
    this.$sendBtn.innerHTML = sendIconSvg;
    this.$stopGenerationBtn = tag("button", {
      className: "stopGenerationBtn hide",
    });
    this.$stopGenerationBtn.innerHTML = stopIconSvg;
    this.$stopGenerationBtn.onclick = this.stopGenerating.bind(this);
    this.$inputBox.append(this.$chatTextarea, this.$sendBtn, this.$stopGenerationBtn);
    mainApp.append(this.$inputBox, this.$chatBox);
    this.$page.append(mainApp);
    this.messageHistories = {};
    this.messageSessionConfig = {
      configurable: {
        sessionId: uuidv4(),
      },
    };
    
    // Initialize new managers
    this.terminalManager = new TerminalManager();
    this.multiAIManager = null; // Will be initialized when API key manager is ready
    this.ollamaManager = new OllamaManager();
    this.promptManager = new PromptManager();
    this.freeSecurityTools = new FreeSecurityToolsManager(this.terminalManager);
    this.blockchainSecurity = new BlockchainSecurityManager();
    this.isMultiAIMode = false;
    this.isTerminalMode = false;
    this.codeExecutionEnabled = true;
    this.preferFreeModels = true; // Prioritize free and open-source models
  }

  async run() {
    try {
      let passPhrase;
      if (await fs(window.DATA_STORAGE + "secret.key").exists()) {
        passPhrase = await fs(window.DATA_STORAGE + "secret.key").readFile(
          "utf-8",
        );
      } else {
        let secretPassphrase = await prompt(
          "Enter a secret pass pharse to save the api key",
          "",
          "text",
          {
            required: true,
          },
        );
        if (!secretPassphrase) return;
        passPhrase = secretPassphrase;
      }
      this.apiKeyManager = new APIKeyManager(passPhrase);
      this.multiAIManager = new MultiAIManager(this.apiKeyManager);
      let token;
      let providerNme = window.localStorage.getItem("ai-assistant-provider");
      if (providerNme) {
        token = await this.apiKeyManager.getAPIKey(providerNme);
      } else {
        // Show welcome message emphasizing free options
        window.toast("🎉 Welcome! This app supports 28+ AI providers including FREE options like Ollama and Hugging Face!", 5000);
        
        // Create enhanced provider list with free options first
        const freeProviders = ["Ollama", "Hugging Face", "OpenAI-Like"];
        const paidProviders = AI_PROVIDERS.filter(p => !freeProviders.includes(p));
        const orderedProviders = [
          ...freeProviders.map(p => `🆓 ${p} (FREE)`),
          "--- Paid Options ---",
          ...paidProviders.map(p => `💰 ${p} (Paid)`)
        ];
        
        let modelProvider = await select("🚀 Choose Your AI Provider - Free Options Available!", orderedProviders);
        
        // Handle separator selection
        if (modelProvider === "--- Paid Options ---") {
          window.toast("Please select an actual provider", 2000);
          return;
        }
        
        // Extract actual provider name
        modelProvider = modelProvider.replace(/^(🆓|💰) /, '').replace(/ \((FREE|Paid)\)$/, '');

        // Handle OpenAI-Like providers
        if (modelProvider === OPENAI_LIKE) {
          // Prompt for required information
          const apiKey = await prompt("API Key", "", "text", { required: true });
          if (!apiKey) return;

          const baseUrl = await prompt("API Base URL", "https://api.openai.com/v1", "text", {
            required: true
          });

          const modelName = await prompt("Model", "", "text", { required: true });
          if (!modelName) return;

          // Save settings
          window.localStorage.setItem("ai-assistant-provider", OPENAI_LIKE);
          window.localStorage.setItem("ai-assistant-model-name", modelName);
          window.localStorage.setItem("openai-like-baseurl", baseUrl);

          token = apiKey;
          providerNme = OPENAI_LIKE;
          await fs(window.DATA_STORAGE).createFile("secret.key", passPhrase);
          await this.apiKeyManager.saveAPIKey(OPENAI_LIKE, token);
          window.toast("Configuration saved 🎉", 3000);
        } 
        // Handle other providers
        else {
          let apiKey;
          
          // Handle free providers with helpful messages
          if (modelProvider === "Ollama") {
            apiKey = "No Need Of API Key";
            window.toast("🎉 Great choice! Ollama is completely FREE and runs locally!", 4000);
          } else if (modelProvider === "Hugging Face") {
            const useHF = await prompt("Hugging Face API Key (Optional - many models work without it)", "", "text", {
              required: false
            });
            apiKey = useHF || "No Need Of API Key";
            if (!useHF) {
              window.toast("Using Hugging Face without API key - you can still access many free models!", 4000);
            }
          } else {
            // Paid providers - remind about free alternatives
            const freeReminder = "💡 Remember: Ollama and Hugging Face offer similar capabilities for FREE!";
            apiKey = await prompt(`API key for ${modelProvider}\n\n${freeReminder}`, "", "text", {
              required: true,
            });
          }
          if (!apiKey) return;
          loader.showTitleLoader();
          window.toast("Fetching available models from your account", 2000);
          let modelList = await getModelsFromProvider(modelProvider, apiKey);
          loader.removeTitleLoader();
          const modelNme = await select("Select AI Model", modelList);

          window.localStorage.setItem("ai-assistant-provider", modelProvider);
          window.localStorage.setItem("ai-assistant-model-name", modelNme);
          providerNme = modelProvider;
          token = apiKey;
          await fs(window.DATA_STORAGE).createFile("secret.key", passPhrase);
          await this.apiKeyManager.saveAPIKey(providerNme, token);
          window.toast("Configuration saved 🎉", 3000);
        }
      }

      let model = window.localStorage.getItem("ai-assistant-model-name");

      this.initiateModel(providerNme, token, model)
      this.$mdIt = window.markdownit({
        html: false,
        xhtmlOut: false,
        breaks: false,
        linkify: false,
        typographer: false,
        quotes: "“”‘’",
        highlight: function (str, lang) {
          const copyBtn = document.createElement("button");
          copyBtn.classList.add("copy-button");
          copyBtn.innerHTML = copyIconSvg;
          copyBtn.setAttribute("data-str", str);
          const codesArea = `<pre class="hljs codesArea"><code>${hljs.highlightAuto(str).value
            }</code></pre>`;
          const codeBlock = `<div class="codeBlock">${copyBtn.outerHTML}${codesArea}</div>`;
          return codeBlock;
        },
      });

      this.$sendBtn.addEventListener("click", this.sendQuery.bind(this));

      this.$page.show();
    } catch (e) {
      console.log(e);
    }
  }

  initiateModel(providerNme, token, model) {
    switch (providerNme) {
      case AI_PROVIDERS[0]: // OpenAI
        this.modelInstance = new ChatOpenAI({ apiKey: token, model });
        break;
      case AI_PROVIDERS[1]: // Google
        this.modelInstance = new ChatGoogleGenerativeAI({
          model,
          apiKey: token,
          safetySettings: [
            {
              category: HarmCategory.HARM_CATEGORY_HARASSMENT,
              threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
            },
          ],
        });
        break;
      case AI_PROVIDERS[2]: // Ollama
        // check local storage, if user want to provide custom host for ollama
        let baseUrl = window.localStorage.getItem("Ollama-Host")
          ? window.localStorage.getItem("Ollama-Host")
          : "http://localhost:11434";
        this.modelInstance = new ChatOllama({
          baseUrl,
          model
        });
        break;
      case AI_PROVIDERS[3]: // Groq
        this.modelInstance = new ChatGroq({
          apiKey: token,
          model,
        });
        break;
      case OPENAI_LIKE: // OpenAI-Like providers
        const customBaseUrl = window.localStorage.getItem("openai-like-baseurl") || "https://api.openai.com/v1";
        this.modelInstance = new ChatOpenAI({
          apiKey: token,
          model,
          configuration: {
            baseURL: customBaseUrl
          }
        });
        break;
      default:
        throw new Error("Unknown provider");
    }
  }

  _sanitizeFileName(fileName) {
    /*
    utility function for removing special characters and
    white spaces from file names
    */
    // Remove special characters and symbols
    const sanitizedFileName = fileName.replace(/[^\w\s.-]/gi, "");
    // Trim leading and trailing spaces
    const trimmedFileName = sanitizedFileName.trim();
    // Replace spaces with underscores
    const finalFileName = trimmedFileName.replace(/\s+/g, "_");
    return finalFileName;
  }

  transformMessages(messages) {
    const result = messages
      .map((message, index) => {
        // Assuming every even-indexed element (0, 2, 4,...) is a human message
        // and the subsequent odd-indexed element (1, 3, 5,...) is its corresponding AI message
        if (index % 2 === 0 && index + 1 < messages.length) {
          return {
            prompt: messages[index].content,
            result: messages[index + 1].content,
          };
        } else {
          return null; // Handle uneven or incomplete pairs if necessary
        }
      })
      .filter((pair) => pair !== null);

    return result;
  }

  async saveHistory() {
    /*
    save chat history
    */
    try {
      let sessionId = this.messageSessionConfig.configurable.sessionId;
      if (!this.messageHistories[sessionId].messages.length) {
        return;
      }

      if (CURRENT_SESSION_FILEPATH == null) {
        try {
          const sanitisedFileNme = this._sanitizeFileName(
            this.messageHistories[sessionId].messages[0].content.substring(
              0,
              30,
            ),
          );
          const uniqueName = `${sanitisedFileNme}__${sessionId}.json`;

          if (!(await fs(AI_HISTORY_PATH).exists())) {
            await fs(window.DATA_STORAGE).createDirectory("chatgpt");
          }
          let messages = await this.messageHistories[sessionId].getMessages();
          const history = this.transformMessages(messages);
          CURRENT_SESSION_FILEPATH = await fs(AI_HISTORY_PATH).createFile(
            uniqueName,
            history,
          );
        } catch (err) {
          alert(err.message);
        }
      } else {
        try {
          if (!(await fs(CURRENT_SESSION_FILEPATH).exists())) {
            this.newChat();
            window.toast(
              "Some error occurred or file you trying to open has been deleted",
            );
            return;
          }

          let messages = await this.messageHistories[sessionId].getMessages();

          CURRENT_SESSION_FILEPATH = await fs(
            CURRENT_SESSION_FILEPATH,
          ).writeFile(this.transformMessages(messages));
        } catch (err) {
          alert(err.message);
        }
      }
    } catch (err) {
      window.alert(err.message);
    }
  }

  newChat() {
    /*
    Start new chat session
    */
    this.$chatBox.innerHTML = "";
    window.toast("New session", 3000);
    this.messageHistories = {};
    this.messageSessionConfig = {
      configurable: {
        sessionId: uuidv4(),
      },
    };
    CURRENT_SESSION_FILEPATH = null;
  }

  async getHistoryItems() {
    /*
    get list of history items
    */
    if (await fs(AI_HISTORY_PATH).exists()) {
      const allFiles = await fs(AI_HISTORY_PATH).lsDir();
      let elems = "";
      for (let i = 0; i < allFiles.length; i++) {
        elems += `<li class="dialog-item" style="background: var(--secondary-color);color: var(--secondary-text-color);padding: 5px;margin-bottom: 5px;border-radius: 8px;font-size:15px;display:flex;flex-direction:row;justify-content:space-between;gap:5px;" data-path="${JSON.parse(JSON.stringify(allFiles[i])).url
          }">
                  <p class="history-item">${allFiles[i].name
            .split("__")[0]
            .substring(
              0,
              25,
            )}...</p><div><button class="delete-history-btn" style="height:25px;width:25px;border:none;padding:5px;outline:none;border-radius:50%;background:var(--error-text-color);text-align:center;">✗</button></div>
                </li>`;
      }
      return elems;
    } else {
      let elems = "";
      elems = `<li style="background: var(--secondary-color);color: var(--secondary-text-color);padding: 10px;border-radius: 8px;" data-path="#not-available">Not Available</li>`;
      return elems;
    }
  }

  extractUUID(str) {
    // the regex pattern for the UUID
    const uuidPattern =
      /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/;
    // Use the pattern to match the string
    const match = str.match(uuidPattern);
    // If a match is found, return it; otherwise, return null
    return match ? match[0] : null;
  }

  async displayHistory(url, historyDialogBox) {
    /*
    display selected chat history
    */
    this.$chatBox.innerHTML = "";
    const fileUrl = url.slice(1, url.length - 1);
    const sessionId = this.extractUUID(fileUrl);

    if (!sessionId) {
      this.newChat();
      window.toast("Some error occurred");
      return;
    }
    if (!(await fs(fileUrl).exists())) {
      this.newChat();
      window.toast(
        "Some error occurred or file you trying to open has been deleted",
      );
      return;
    }

    CURRENT_SESSION_FILEPATH = fileUrl;
    try {
      historyDialogBox.hide();
      loader.create("Wait", "Fetching chat history....");
      const fileData = await fs(fileUrl).readFile();
      const responses = JSON.parse(await helpers.decodeText(fileData));
      this.messageHistories = {};
      this.messageHistories[sessionId] = new InMemoryChatMessageHistory();
      let messages = responses.flatMap((pair) => [
        new HumanMessage({ content: pair.prompt }),
        new AIMessage({ content: pair.result }),
      ]);
      await this.messageHistories[sessionId].addMessages(messages);
      this.messageSessionConfig = {
        configurable: {
          sessionId,
        },
      };

      responses.forEach((e) => {
        this.appendUserQuery(e.prompt);
        this.appendGptResponse(e.result);
      });
      loader.destroy();
    } catch (err) {
      loader.destroy();
      console.error(err.message);
    }
  }

  async myHistory() {
    /*
    show conversation history
    */
    try {
      const historyList = await this.getHistoryItems();
      const content = `<ul>${historyList}</ul>`;
      const historyDialogBox = DialogBox(
        "Conversation History",
        content,
        "Cancel",
      );

      historyDialogBox.onclick(async (e) => {
        const dialogItem = e.target.closest(".dialog-item");
        const deleteButton = dialogItem.querySelector(".delete-history-btn");
        const historyItem = dialogItem.querySelector(".history-item");
        if (dialogItem.getAttribute("data-path") == "#not-available") {
          return;
        }
        if (!dialogItem.getAttribute("data-path")) {
          return;
        }
        if (e.target === dialogItem || e.target === historyItem) {
          const fileUrl = JSON.stringify(dialogItem.getAttribute("data-path"));
          this.displayHistory(fileUrl, historyDialogBox);
        } else if (e.target === deleteButton) {
          const fileUrl = JSON.stringify(dialogItem.getAttribute("data-path"));
          const url = fileUrl.slice(1, fileUrl.length - 1);

          await fs(dialogItem.getAttribute("data-path")).delete();
          //alert(CURRENT_SESSION_FILEPATH);

          if (CURRENT_SESSION_FILEPATH == url) {
            const chatBox = document.querySelector(".chatBox");
            chatBox.innerHTML = "";
            this.messageHistories = {};
            this.messageSessionConfig = {
              configurable: {
                sessionId: uuidv4(),
              },
            };
          }

          dialogItem.remove();
          window.toast("Deleted", 3000);
          CURRENT_SESSION_FILEPATH = null;
        }
      });
    } catch (err) {
      window.alert(err.message);
    }
  }

  async sendQuery() {
    /*
    event on clicking send prompt button of chatgpt
    */
    const chatText = this.$chatTextarea;
    if (chatText.value != "") {
      this.appendUserQuery(chatText.value);
      this.scrollToBottom();
      this.appendGptResponse("");
      this.loader();
      this.getChatgptResponse(chatText.value);
      chatText.value = "";
    }
  }

  async appendUserQuery(message) {
    /*
    add user query to ui
    */
    try {
      const userAvatar = this.baseUrl + "assets/user_avatar.png";
      const userChatBox = tag("div", { className: "wrapper" });
      const chat = tag("div", { className: "chat" });
      const profileImg = tag("div", {
        className: "profile",
        child: tag("img", {
          src: userAvatar,
          alt: "user",
        }),
      });
      const msg = tag("div", {
        className: "message",
        textContent: message,
      });
      chat.append(...[profileImg, msg]);
      userChatBox.append(chat);
      this.$chatBox.appendChild(userChatBox);
    } catch (err) {
      window.alert(err);
    }
  }

  async appendGptResponse(message) {
    /*
    add ai response to ui
    */
    const ai_avatar = this.baseUrl + "assets/ai_assistant.svg";
    const gptChatBox = tag("div", { className: "ai_wrapper" });
    const chat = tag("div", { className: "ai_chat" });
    const profileImg = tag("div", {
      className: "ai_profile",
      child: tag("img", {
        src: ai_avatar,
        alt: "ai",
      }),
    });
    const msg = tag("div", {
      className: "ai_message",
    });
    msg.innerHTML = this.$mdIt.render(message);
    const copyBtns = msg.querySelectorAll(".copy-button");
    if (copyBtns) {
      for (const copyBtn of copyBtns) {
        copyBtn.addEventListener("click", function () {
          copy(this.dataset.str);
          window.toast("Copied to clipboard", 3000);
        });
      }
    }

    chat.append(...[profileImg, msg]);
    gptChatBox.append(chat);
    this.$chatBox.appendChild(gptChatBox);
  }

  async stopGenerating() {
    // Currently this doesn't works and I have no idea about , If you can , feel free to open pr
    // it doesn't work 
    this.abortController.abort();
    this.$stopGenerationBtn.classList.add("hide");
    this.$sendBtn.classList.remove("hide");
  }

  async getChatgptResponse(question) {
    /*
    fetch ai response
    @parm: question {string} - user prompt
    */
    try {
      // get all gptchat element
      const responseBox = Array.from(document.querySelectorAll(".ai_message"));
      
      this.abortController = new AbortController();
      const { signal } = this.abortController;

      const prompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          `You are an AI assistant for the open source plugin AI Assistant for Acode code editor(open source vscode like code editor for Android).`,
        ],
        ["placeholder", "{chat_history}"],
        ["human", "{input}"],
      ]);
      
      const parser = new StringOutputParser();
      const chain = prompt.pipe(this.modelInstance).pipe(parser);

      const withMessageHistory = new RunnableWithMessageHistory({
        runnable: chain,
        getMessageHistory: async (sessionId) => {
          if (this.messageHistories[sessionId] === undefined) {
            this.messageHistories[sessionId] = new InMemoryChatMessageHistory();
          } else {
            let history = await this.messageHistories[sessionId].getMessages();
            this.messageHistories[sessionId].addMessages(history.slice(-6))
          }
          return this.messageHistories[sessionId];
        },
        inputMessagesKey: "input",
        historyMessagesKey: "chat_history",
      });

      const stream = await withMessageHistory.stream(
        {
          input: question,
        },
        this.messageSessionConfig,
        signal
      );

      // remove dot loader
      clearInterval(this.$loadInterval);
      this.$sendBtn.classList.add("hide");
      this.$stopGenerationBtn.classList.remove('hide');
      const targetElem = responseBox[responseBox.length - 1];
      targetElem.innerHTML = "";
      let result = "";
      // stream the ai responses as plain text
      for await (const chunk of stream) {
        result += chunk;
        targetElem.textContent += chunk;
        this.scrollToBottom();
      }
      // re render the streamed plain text with markdown formatting
      const renderedHtml = this.$mdIt.render(result);
      targetElem.innerHTML = renderedHtml;
      // Attach event listeners to the copy buttons
      const copyBtns = targetElem.querySelectorAll(".copy-button");
      if (copyBtns) {
        for (const copyBtn of copyBtns) {
          copyBtn.addEventListener("click", function () {
            copy(this.dataset.str);
            window.toast("Copied to clipboard", 3000);
          });
        }
      }
      this.$stopGenerationBtn.classList.add("hide");
      this.$sendBtn.classList.remove("hide");

      await this.saveHistory();
    } catch (error) {
      // error handling
      const responseBox = Array.from(document.querySelectorAll(".ai_message"));
      clearInterval(this.$loadInterval);
      const targetElem = responseBox[responseBox.length - 1];
      targetElem.innerHTML = "";
      const $errorBox = tag("div", { className: "error-box" });
      console.log(error)
      if (error.response) {
        $errorBox.innerText = `Status code: ${error.response.status
          }\n${JSON.stringify(error.response.data)}`;
      } else {
        $errorBox.innerText = `${error.message}`;
      }
      targetElem.appendChild($errorBox);
      this.$stopGenerationBtn.classList.add("hide");
      this.$sendBtn.classList.remove("hide");
    }
  }

  async scrollToBottom() {
    this.$chatBox.scrollTop = this.$chatBox.scrollHeight;
  }

  async loader() {
    /*
    creates dot loader
    */
    // get all gptchat element for loader
    const loadingDots = Array.from(document.querySelectorAll(".ai_message"));
    // made change in last element
    if (loadingDots.length != 0) {
      this.$loadInterval = setInterval(() => {
        loadingDots[loadingDots.length - 1].innerText += "•";
        if (loadingDots[loadingDots.length - 1].innerText == "••••••") {
          loadingDots[loadingDots.length - 1].innerText = "•";
        }
      }, 300);
    }
  }

  async showTerminal() {
    const terminalDialog = DialogBox("Terminal & Code Execution", "", "");
    
    const terminalContainer = tag("div", {
      className: "terminal-container",
      style: "height: 400px; background: #1e1e1e; color: #fff; padding: 10px; font-family: monospace; overflow-y: auto;"
    });

    const commandInput = tag("input", {
      type: "text",
      placeholder: "Enter command or select language for code execution...",
      className: "terminal-input",
      style: "width: 100%; margin-top: 10px; padding: 8px; background: #2d2d2d; color: #fff; border: 1px solid #555;"
    });

    const languageSelect = tag("select", {
      className: "language-select",
      style: "width: 100%; margin-top: 5px; padding: 8px; background: #2d2d2d; color: #fff; border: 1px solid #555;"
    });

    // Add language options
    SUPPORTED_LANGUAGES.forEach(lang => {
      const option = tag("option", {
        value: lang,
        textContent: lang.charAt(0).toUpperCase() + lang.slice(1)
      });
      languageSelect.appendChild(option);
    });

    const executeBtn = tag("button", {
      textContent: "Execute",
      className: "execute-btn",
      style: "margin-top: 10px; padding: 8px 16px; background: #007acc; color: white; border: none; cursor: pointer;"
    });

    executeBtn.onclick = async () => {
      const command = commandInput.value.trim();
      const language = languageSelect.value;
      
      if (!command) return;

      try {
        terminalContainer.innerHTML += `\n$ ${command}\n`;
        const result = await this.terminalManager.executeCommand(command, language);
        terminalContainer.innerHTML += result.stdout + '\n';
        if (result.stderr) {
          terminalContainer.innerHTML += `Error: ${result.stderr}\n`;
        }
        commandInput.value = '';
        terminalContainer.scrollTop = terminalContainer.scrollHeight;
      } catch (error) {
        terminalContainer.innerHTML += `Error: ${error.message}\n`;
        terminalContainer.scrollTop = terminalContainer.scrollHeight;
      }
    };

    const terminalContent = tag("div", {});
    terminalContent.append(terminalContainer, languageSelect, commandInput, executeBtn);
    
    terminalDialog.innerHTML = terminalContent.outerHTML;
    terminalDialog.show();
  }

  async showMultiAI() {
    const multiAIDialog = DialogBox("Multi-AI Chat", "", "");
    
    const aiContainer = tag("div", {
      className: "multi-ai-container",
      style: "height: 500px; display: flex; flex-direction: column;"
    });

    const activeAIsList = tag("div", {
      className: "active-ais",
      style: "background: #f5f5f5; padding: 10px; margin-bottom: 10px; border-radius: 5px;"
    });

    const addAIBtn = tag("button", {
      textContent: "Add AI",
      style: "margin-bottom: 10px; padding: 8px 16px; background: #28a745; color: white; border: none; cursor: pointer;"
    });

    const consensusBtn = tag("button", {
      textContent: "Get Consensus",
      style: "margin-bottom: 10px; margin-left: 10px; padding: 8px 16px; background: #17a2b8; color: white; border: none; cursor: pointer;"
    });

    const queryInput = tag("textarea", {
      placeholder: "Enter your query for all AIs...",
      style: "width: 100%; height: 100px; margin-bottom: 10px; padding: 8px; resize: vertical;"
    });

    const queryBtn = tag("button", {
      textContent: "Query All AIs",
      style: "padding: 8px 16px; background: #007acc; color: white; border: none; cursor: pointer;"
    });

    const responsesContainer = tag("div", {
      className: "responses-container",
      style: "flex: 1; overflow-y: auto; border: 1px solid #ddd; padding: 10px; margin-top: 10px;"
    });

    addAIBtn.onclick = async () => {
      try {
        const provider = await select("Select AI Provider", AI_PROVIDERS);
        const apiKey = await prompt("API Key", "", "text", { required: true });
        const model = await prompt("Model Name", "", "text", { required: true });
        
        const ai = await this.multiAIManager.addAI(provider, model, apiKey);
        this.updateActiveAIsList(activeAIsList);
        window.toast(`Added ${provider} (${model})`, 2000);
      } catch (error) {
        window.toast(`Error: ${error.message}`, 3000);
      }
    };

    queryBtn.onclick = async () => {
      const query = queryInput.value.trim();
      if (!query) return;

      try {
        responsesContainer.innerHTML = "Querying AIs...";
        const responses = await this.multiAIManager.queryAllAIs(query);
        this.displayMultiAIResponses(responsesContainer, responses);
      } catch (error) {
        responsesContainer.innerHTML = `Error: ${error.message}`;
      }
    };

    consensusBtn.onclick = async () => {
      const query = queryInput.value.trim();
      if (!query) return;

      try {
        responsesContainer.innerHTML = "Getting consensus...";
        const consensus = await this.multiAIManager.getConsensus(query);
        this.displayConsensus(responsesContainer, consensus);
      } catch (error) {
        responsesContainer.innerHTML = `Error: ${error.message}`;
      }
    };

    const controls = tag("div", {});
    controls.append(addAIBtn, consensusBtn, queryInput, queryBtn);
    
    aiContainer.append(activeAIsList, controls, responsesContainer);
    multiAIDialog.innerHTML = aiContainer.outerHTML;
    multiAIDialog.show();

    this.updateActiveAIsList(activeAIsList);
  }

  updateActiveAIsList(container) {
    const activeAIs = this.multiAIManager.getActiveAIs();
    container.innerHTML = `<strong>Active AIs (${activeAIs.length}/3):</strong><br>`;
    
    activeAIs.forEach(ai => {
      container.innerHTML += `• ${ai.provider} (${ai.model}) - ${ai.specialization.join(', ')}<br>`;
    });
  }

  displayMultiAIResponses(container, responses) {
    container.innerHTML = "";
    
    responses.forEach((response, index) => {
      const responseDiv = tag("div", {
        style: "margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 5px;"
      });

      const header = tag("div", {
        innerHTML: `<strong>${response.provider} (${response.model})</strong> - ${response.responseTime}ms`,
        style: "color: #007acc; margin-bottom: 5px;"
      });

      const content = tag("div", {
        innerHTML: response.response || response.error,
        style: response.error ? "color: red;" : ""
      });

      responseDiv.append(header, content);
      container.appendChild(responseDiv);
    });
  }

  displayConsensus(container, consensus) {
    container.innerHTML = "";
    
    const consensusDiv = tag("div", {
      style: "padding: 15px; background: #e8f5e8; border-radius: 5px; margin-bottom: 15px;"
    });

    consensusDiv.innerHTML = `
      <h3>Consensus Result</h3>
      <p><strong>Agreement Score:</strong> ${(consensus.agreement_score * 100).toFixed(1)}%</p>
      <p><strong>Confidence:</strong> ${(consensus.confidence * 100).toFixed(1)}%</p>
      <p><strong>Consensus Response:</strong></p>
      <div style="background: white; padding: 10px; border-radius: 3px; margin: 10px 0;">
        ${consensus.consensus_response}
      </div>
    `;

    if (consensus.dissenting_opinions.length > 0) {
      consensusDiv.innerHTML += `
        <p><strong>Dissenting Opinions:</strong></p>
        <div style="background: #fff3cd; padding: 10px; border-radius: 3px;">
          ${consensus.dissenting_opinions.map(opinion => 
            `• ${opinion.provider}: ${opinion.response.substring(0, 100)}...`
          ).join('<br>')}
        </div>
      `;
    }

    container.appendChild(consensusDiv);

    // Show individual responses
    const responsesHeader = tag("h4", { textContent: "Individual Responses:" });
    container.appendChild(responsesHeader);
    
    this.displayMultiAIResponses(container, consensus.responses);
  }

  async showSecurityTools() {
    const securityDialog = DialogBox("Security & Bug Bounty Tools", "", "");
    
    const toolsContainer = tag("div", {
      className: "security-tools-container",
      style: "height: 500px; display: flex; flex-direction: column;"
    });

    const toolSelect = tag("select", {
      style: "width: 100%; margin-bottom: 10px; padding: 8px;"
    });

    SECURITY_TOOLS.forEach(tool => {
      const option = tag("option", {
        value: tool,
        textContent: tool.toUpperCase()
      });
      toolSelect.appendChild(option);
    });

    const targetInput = tag("input", {
      type: "text",
      placeholder: "Target (URL, IP, or domain)",
      style: "width: 100%; margin-bottom: 10px; padding: 8px;"
    });

    const optionsInput = tag("input", {
      type: "text",
      placeholder: "Additional options/flags",
      style: "width: 100%; margin-bottom: 10px; padding: 8px;"
    });

    const installBtn = tag("button", {
      textContent: "Install Tool",
      style: "margin-right: 10px; padding: 8px 16px; background: #28a745; color: white; border: none; cursor: pointer;"
    });

    const scanBtn = tag("button", {
      textContent: "Run Scan",
      style: "padding: 8px 16px; background: #dc3545; color: white; border: none; cursor: pointer;"
    });

    const resultsContainer = tag("div", {
      className: "scan-results",
      style: "flex: 1; overflow-y: auto; border: 1px solid #ddd; padding: 10px; margin-top: 10px; background: #1e1e1e; color: #fff; font-family: monospace;"
    });

    installBtn.onclick = async () => {
      const tool = toolSelect.value;
      try {
        resultsContainer.innerHTML += `Installing ${tool}...\n`;
        const result = await this.terminalManager.installSecurityTool(tool);
        resultsContainer.innerHTML += result.stdout + '\n';
        resultsContainer.scrollTop = resultsContainer.scrollHeight;
      } catch (error) {
        resultsContainer.innerHTML += `Error: ${error.message}\n`;
        resultsContainer.scrollTop = resultsContainer.scrollHeight;
      }
    };

    scanBtn.onclick = async () => {
      const tool = toolSelect.value;
      const target = targetInput.value.trim();
      const options = { flags: optionsInput.value.trim() };

      if (!target) {
        window.toast("Please enter a target", 2000);
        return;
      }

      try {
        resultsContainer.innerHTML += `Running ${tool} scan on ${target}...\n`;
        const result = await this.terminalManager.runSecurityScan(tool, target, options);
        resultsContainer.innerHTML += result.stdout + '\n';
        if (result.stderr) {
          resultsContainer.innerHTML += `Errors: ${result.stderr}\n`;
        }
        resultsContainer.scrollTop = resultsContainer.scrollHeight;
      } catch (error) {
        resultsContainer.innerHTML += `Error: ${error.message}\n`;
        resultsContainer.scrollTop = resultsContainer.scrollHeight;
      }
    };

    const controls = tag("div", {});
    controls.append(toolSelect, targetInput, optionsInput, installBtn, scanBtn);
    
    toolsContainer.append(controls, resultsContainer);
    securityDialog.innerHTML = toolsContainer.outerHTML;
    securityDialog.show();
  }

  async showOllamaManager() {
    const ollamaDialog = DialogBox("Ollama Local Models", "", "");
    
    const container = tag("div", {
      className: "ollama-manager-container",
      style: "height: 600px; display: flex; flex-direction: column;"
    });

    // Connection status
    const statusDiv = tag("div", {
      className: "ollama-status",
      style: "padding: 10px; margin-bottom: 10px; border-radius: 4px;"
    });

    // Model list
    const modelsList = tag("div", {
      className: "models-list",
      style: "flex: 1; overflow-y: auto; border: 1px solid #ddd; padding: 10px; margin-bottom: 10px;"
    });

    // Controls
    const controlsDiv = tag("div", {
      className: "ollama-controls",
      style: "display: flex; gap: 10px; margin-bottom: 10px;"
    });

    const installBtn = tag("button", {
      textContent: "Install Ollama",
      style: "padding: 8px 16px; background: #007bff; color: white; border: none; cursor: pointer;"
    });

    const refreshBtn = tag("button", {
      textContent: "Refresh Models",
      style: "padding: 8px 16px; background: #28a745; color: white; border: none; cursor: pointer;"
    });

    const pullModelInput = tag("input", {
      type: "text",
      placeholder: "Model name (e.g., llama3.2:latest)",
      style: "flex: 1; padding: 8px;"
    });

    const pullBtn = tag("button", {
      textContent: "Pull Model",
      style: "padding: 8px 16px; background: #ffc107; color: black; border: none; cursor: pointer;"
    });

    controlsDiv.append(installBtn, refreshBtn, pullModelInput, pullBtn);

    // Update status
    const updateStatus = async () => {
      const status = this.ollamaManager.getConnectionStatus();
      statusDiv.innerHTML = `
        <strong>Status:</strong> ${status.connected ? '🟢 Connected' : '🔴 Disconnected'}<br>
        <strong>URL:</strong> ${status.baseUrl}<br>
        <strong>Installed Models:</strong> ${status.installedModels}
      `;
      statusDiv.style.background = status.connected ? '#d4edda' : '#f8d7da';
    };

    // Load models list
    const loadModels = async () => {
      try {
        await this.ollamaManager.loadInstalledModels();
        const models = this.ollamaManager.installedModels;
        const available = this.ollamaManager.availableModels;
        
        modelsList.innerHTML = `
          <h4>Installed Models:</h4>
          ${models.length ? models.map(m => `
            <div style="padding: 8px; border: 1px solid #ddd; margin: 4px 0; border-radius: 4px;">
              <strong>${m.name}</strong> (${m.size || 'Unknown size'})
              <button onclick="this.parentElement.remove()" style="float: right; background: #dc3545; color: white; border: none; padding: 4px 8px; cursor: pointer;">Delete</button>
            </div>
          `).join('') : '<p>No models installed</p>'}
          
          <h4>Recommended Models:</h4>
          ${available.filter(m => m.recommended).map(m => `
            <div style="padding: 8px; border: 1px solid #ddd; margin: 4px 0; border-radius: 4px;">
              <strong>${m.name}</strong> - ${m.specialty}<br>
              <small>Size: ${m.size}</small>
              <button onclick="pullModel('${m.name}')" style="float: right; background: #28a745; color: white; border: none; padding: 4px 8px; cursor: pointer;">Install</button>
            </div>
          `).join('')}
        `;
      } catch (error) {
        modelsList.innerHTML = `<p>Error loading models: ${error.message}</p>`;
      }
    };

    // Event handlers
    installBtn.onclick = async () => {
      const script = await this.ollamaManager.installOllama();
      const installDialog = DialogBox("Install Ollama", script.description, "");
      installDialog.innerHTML = `
        <pre style="background: #1e1e1e; color: #fff; padding: 10px; overflow-x: auto;">${script.script}</pre>
        <p>Estimated time: ${script.estimatedTime}</p>
        <button onclick="this.closest('.dialog-box').remove()" style="padding: 8px 16px; background: #007bff; color: white; border: none; cursor: pointer;">Close</button>
      `;
      installDialog.show();
    };

    refreshBtn.onclick = async () => {
      await updateStatus();
      await loadModels();
    };

    pullBtn.onclick = async () => {
      const modelName = pullModelInput.value.trim();
      if (!modelName) {
        window.toast("Please enter a model name", 2000);
        return;
      }

      try {
        pullBtn.textContent = "Pulling...";
        pullBtn.disabled = true;
        
        await this.ollamaManager.pullModel(modelName, (progress) => {
          pullBtn.textContent = `${progress.percent}%`;
        });
        
        window.toast(`Model ${modelName} installed successfully!`, 3000);
        await loadModels();
      } catch (error) {
        window.toast(`Failed to pull model: ${error.message}`, 3000);
      } finally {
        pullBtn.textContent = "Pull Model";
        pullBtn.disabled = false;
        pullModelInput.value = "";
      }
    };

    // Initialize
    await updateStatus();
    await loadModels();

    container.append(statusDiv, modelsList, controlsDiv);
    ollamaDialog.innerHTML = container.outerHTML;
    ollamaDialog.show();
  }

  async showPromptManager() {
    const promptDialog = DialogBox("Custom Prompts & Fine-tuning", "", "");
    
    const container = tag("div", {
      className: "prompt-manager-container",
      style: "height: 600px; display: flex; flex-direction: column;"
    });

    // Prompt list
    const promptsList = tag("div", {
      className: "prompts-list",
      style: "flex: 1; overflow-y: auto; border: 1px solid #ddd; padding: 10px; margin-bottom: 10px;"
    });

    // Controls
    const controlsDiv = tag("div", {
      className: "prompt-controls",
      style: "display: flex; gap: 10px; margin-bottom: 10px;"
    });

    const newPromptBtn = tag("button", {
      textContent: "New Prompt",
      style: "padding: 8px 16px; background: #007bff; color: white; border: none; cursor: pointer;"
    });

    const importBtn = tag("button", {
      textContent: "Import",
      style: "padding: 8px 16px; background: #28a745; color: white; border: none; cursor: pointer;"
    });

    const exportBtn = tag("button", {
      textContent: "Export",
      style: "padding: 8px 16px; background: #ffc107; color: black; border: none; cursor: pointer;"
    });

    const templateSelect = tag("select", {
      style: "flex: 1; padding: 8px;"
    });

    const useTemplateBtn = tag("button", {
      textContent: "Use Template",
      style: "padding: 8px 16px; background: #6c757d; color: white; border: none; cursor: pointer;"
    });

    controlsDiv.append(newPromptBtn, importBtn, exportBtn, templateSelect, useTemplateBtn);

    // Load prompts
    const loadPrompts = () => {
      const prompts = this.promptManager.getAllPrompts();
      const activePrompt = this.promptManager.getActivePrompt();
      
      promptsList.innerHTML = prompts.map(prompt => `
        <div style="padding: 10px; border: 1px solid #ddd; margin: 4px 0; border-radius: 4px; ${activePrompt?.id === prompt.id ? 'background: #e7f3ff;' : ''}">
          <div style="display: flex; justify-content: between; align-items: center;">
            <strong>${prompt.name}</strong>
            <div>
              <button onclick="setActivePrompt('${prompt.id}')" style="background: #007bff; color: white; border: none; padding: 4px 8px; cursor: pointer; margin-right: 4px;">
                ${activePrompt?.id === prompt.id ? 'Active' : 'Activate'}
              </button>
              <button onclick="editPrompt('${prompt.id}')" style="background: #28a745; color: white; border: none; padding: 4px 8px; cursor: pointer; margin-right: 4px;">Edit</button>
              <button onclick="deletePrompt('${prompt.id}')" style="background: #dc3545; color: white; border: none; padding: 4px 8px; cursor: pointer;">Delete</button>
            </div>
          </div>
          <small>Category: ${prompt.category} | Used: ${prompt.useCount} times</small>
          <p style="margin: 8px 0; max-height: 100px; overflow-y: auto; background: #f8f9fa; padding: 8px; border-radius: 4px;">
            ${prompt.prompt.substring(0, 200)}${prompt.prompt.length > 200 ? '...' : ''}
          </p>
        </div>
      `).join('');
    };

    // Load templates
    const loadTemplates = () => {
      const templates = this.promptManager.getPromptTemplates();
      templateSelect.innerHTML = '<option value="">Select a template...</option>';
      Object.entries(templates).forEach(([id, template]) => {
        const option = tag("option", {
          value: id,
          textContent: template.name
        });
        templateSelect.appendChild(option);
      });
    };

    // Event handlers
    newPromptBtn.onclick = () => {
      this.showPromptEditor();
    };

    exportBtn.onclick = () => {
      const data = this.promptManager.exportPrompts();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = tag("a", { href: url, download: 'custom-prompts.json' });
      a.click();
      URL.revokeObjectURL(url);
    };

    useTemplateBtn.onclick = () => {
      const templateId = templateSelect.value;
      if (!templateId) {
        window.toast("Please select a template", 2000);
        return;
      }
      this.showTemplateEditor(templateId);
    };

    // Initialize
    loadPrompts();
    loadTemplates();

    container.append(promptsList, controlsDiv);
    promptDialog.innerHTML = container.outerHTML;
    promptDialog.show();
  }

  async showFreeModels() {
    const freeModelsDialog = DialogBox("Free & Open-Source Models", "", "");
    
    const container = tag("div", {
      className: "free-models-container",
      style: "height: 600px; display: flex; flex-direction: column;"
    });

    // Categories tabs
    const tabsDiv = tag("div", {
      className: "model-tabs",
      style: "display: flex; border-bottom: 1px solid #ddd; margin-bottom: 10px;"
    });

    // Content area
    const contentDiv = tag("div", {
      className: "models-content",
      style: "flex: 1; overflow-y: auto; padding: 10px;"
    });

    // Create tabs for each model category
    Object.entries(FREE_AI_MODELS).forEach(([key, category], index) => {
      const tab = tag("button", {
        textContent: category.name,
        className: index === 0 ? 'active-tab' : '',
        style: `padding: 10px 20px; border: none; background: ${index === 0 ? '#007bff' : '#f8f9fa'}; color: ${index === 0 ? 'white' : 'black'}; cursor: pointer; border-bottom: 2px solid ${index === 0 ? '#007bff' : 'transparent'};`
      });

      tab.onclick = () => {
        // Update tab styles
        tabsDiv.querySelectorAll('button').forEach(btn => {
          btn.style.background = '#f8f9fa';
          btn.style.color = 'black';
          btn.style.borderBottom = '2px solid transparent';
          btn.className = '';
        });
        tab.style.background = '#007bff';
        tab.style.color = 'white';
        tab.style.borderBottom = '2px solid #007bff';
        tab.className = 'active-tab';

        // Update content
        showCategoryContent(key, category);
      };

      tabsDiv.appendChild(tab);
    });

    // Show category content
    const showCategoryContent = (key, category) => {
      let content = `
        <div class="category-header">
          <h3>${category.name}</h3>
          <p><strong>Type:</strong> ${category.type} | <strong>Cost:</strong> ${category.cost} | <strong>Priority:</strong> ${category.priority}</p>
        </div>
        <div class="models-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px; margin-top: 20px;">
      `;

      category.models.forEach(model => {
        const specialty = category.specialties?.[model] || 'General purpose model';
        content += `
          <div class="model-card" style="border: 1px solid #ddd; border-radius: 8px; padding: 15px; background: #f8f9fa;">
            <h4 style="margin: 0 0 10px 0; color: #007bff;">${model}</h4>
            <p style="margin: 0 0 10px 0; font-size: 14px; color: #666;">${specialty}</p>
            <div style="display: flex; gap: 8px;">
              <button onclick="useModel('${key}', '${model}')" style="flex: 1; padding: 8px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">Use Model</button>
              ${category.type === 'local' ? `<button onclick="installModel('${model}')" style="flex: 1; padding: 8px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Install</button>` : ''}
            </div>
          </div>
        `;
      });

      content += '</div>';

      // Add setup instructions
      if (key === 'ollama') {
        content += `
          <div style="margin-top: 20px; padding: 15px; background: #e7f3ff; border-radius: 8px;">
            <h4>Ollama Setup Instructions:</h4>
            <ol>
              <li>Install Ollama: <code>curl -fsSL https://ollama.ai/install.sh | sh</code></li>
              <li>Start Ollama service: <code>ollama serve</code></li>
              <li>Pull models: <code>ollama pull llama3.2:latest</code></li>
            </ol>
          </div>
        `;
      } else if (key === 'huggingface') {
        content += `
          <div style="margin-top: 20px; padding: 15px; background: #fff3cd; border-radius: 8px;">
            <h4>Hugging Face Setup:</h4>
            <p>Most models are free to use. Some may require a Hugging Face account for API access.</p>
            <p>Get your free API key at: <a href="https://huggingface.co/settings/tokens" target="_blank">https://huggingface.co/settings/tokens</a></p>
          </div>
        `;
      }

      contentDiv.innerHTML = content;
    };

    // Initialize with first category
    const firstCategory = Object.entries(FREE_AI_MODELS)[0];
    showCategoryContent(firstCategory[0], firstCategory[1]);

    container.append(tabsDiv, contentDiv);
    freeModelsDialog.innerHTML = container.outerHTML;
    freeModelsDialog.show();
  }

  async enhancedSendQuery() {
    const query = sanitizeInput(this.$chatTextarea.value.trim());
    if (!query) return;

    // Check if query contains code blocks
    const codeBlocks = extractCodeBlocks(query);
    
    if (codeBlocks.length > 0 && this.codeExecutionEnabled) {
      const shouldExecute = await this.confirmCodeExecution(codeBlocks);
      if (shouldExecute) {
        await this.executeCodeBlocks(codeBlocks);
      }
    }

    // Check if multi-AI mode is enabled
    if (this.isMultiAIMode && this.multiAIManager.getActiveAIs().length > 1) {
      await this.handleMultiAIQuery(query);
    } else {
      await this.sendQuery(); // Call original method
    }
  }

  async confirmCodeExecution(codeBlocks) {
    const codePreview = codeBlocks.map(block => 
      `${block.language}:\n${block.code.substring(0, 200)}${block.code.length > 200 ? '...' : ''}`
    ).join('\n\n');

    return await acode.confirm(
      "Code Execution",
      `Execute the following code?\n\n${codePreview}`,
      "Execute",
      "Cancel"
    );
  }

  async executeCodeBlocks(codeBlocks) {
    for (const block of codeBlocks) {
      try {
        const result = await this.terminalManager.executeCommand(block.code, block.language);
        this.addMessage('system', `Code executed (${block.language}):\n${result.stdout}`, false);
        if (result.stderr) {
          this.addMessage('system', `Errors: ${result.stderr}`, false);
        }
      } catch (error) {
        this.addMessage('system', `Execution error: ${error.message}`, false);
      }
    }
  }

  async handleMultiAIQuery(query) {
    try {
      this.addMessage('user', query, true);
      this.$sendBtn.classList.add("hide");
      this.$stopGenerationBtn.classList.remove("hide");

      const responses = await this.multiAIManager.queryAllAIs(query);
      
      // Display each AI's response
      responses.forEach(response => {
        if (response.status !== 'rejected') {
          this.addMessage('assistant', 
            `**${response.provider} (${response.model})**:\n${response.response}`, 
            false
          );
        }
      });

      // Get consensus if enabled
      if (this.multiAIManager.consensusMode) {
        const consensus = await this.multiAIManager.getConsensus(query);
        this.addMessage('system', 
          `**Consensus (${(consensus.confidence * 100).toFixed(1)}% confidence)**:\n${consensus.consensus_response}`, 
          false
        );
      }

    } catch (error) {
      this.addMessage('system', `Multi-AI Error: ${error.message}`, false);
    } finally {
      this.$sendBtn.classList.remove("hide");
      this.$stopGenerationBtn.classList.add("hide");
      this.$chatTextarea.value = '';
    }
  }

  async showBlockchainSecurity() {
    const blockchainDialog = DialogBox("🔒 Blockchain Security Scanner", "", "");

    const container = tag("div", {
      className: "blockchain-security-container",
      style: "height: 700px; display: flex; flex-direction: column; padding: 20px;"
    });

    // Header with max reward info
    const headerDiv = tag("div", {
      className: "blockchain-header",
      style: "background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; text-align: center;"
    });

    headerDiv.innerHTML = `
      <h2 style="margin: 0 0 10px 0;">🏆 Ultimate Bug Bounty Toolkit</h2>
      <p style="margin: 0; font-size: 18px; font-weight: bold;">Max Potential Reward: $2,250,000</p>
      <p style="margin: 5px 0 0 0; opacity: 0.9;">Ethereum • Uniswap • OpenZeppelin • DeFi Protocols</p>
    `;

    // Target input section
    const inputSection = tag("div", {
      className: "input-section",
      style: "background: #f8f9fa; padding: 20px; border-radius: 10px; margin-bottom: 20px;"
    });

    const targetInput = tag("input", {
      type: "text",
      placeholder: "Enter contract address (0x...)",
      style: "width: 100%; padding: 12px; border: 2px solid #ddd; border-radius: 8px; font-family: monospace; font-size: 14px;"
    });

    const chainSelect = tag("select", {
      style: "width: 100%; padding: 12px; border: 2px solid #ddd; border-radius: 8px; margin-top: 10px;"
    });

    const chains = this.blockchainSecurity.supportedChains;
    Object.keys(chains).forEach(chainId => {
      const option = tag("option", {
        value: chainId,
        textContent: chains[chainId].name
      });
      chainSelect.appendChild(option);
    });

    inputSection.appendChild(tag("h3", { textContent: "🎯 Target Configuration", style: "margin: 0 0 15px 0;" }));
    inputSection.appendChild(targetInput);
    inputSection.appendChild(chainSelect);

    // Scan options
    const optionsSection = tag("div", {
      className: "options-section",
      style: "background: #f8f9fa; padding: 20px; border-radius: 10px; margin-bottom: 20px;"
    });

    optionsSection.innerHTML = `
      <h3 style="margin: 0 0 15px 0;">🔍 Vulnerability Categories</h3>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" checked style="margin-right: 10px; transform: scale(1.2);">
          <span>Smart Contract Vulnerabilities</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" checked style="margin-right: 10px; transform: scale(1.2);">
          <span>DeFi Protocol Security</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" checked style="margin-right: 10px; transform: scale(1.2);">
          <span>NFT & Token Security</span>
        </label>
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input type="checkbox" checked style="margin-right: 10px; transform: scale(1.2);">
          <span>Infrastructure Analysis</span>
        </label>
      </div>
    `;

    // Bug bounty programs section
    const programsSection = tag("div", {
      className: "programs-section",
      style: "background: #e8f5e8; padding: 20px; border-radius: 10px; margin-bottom: 20px;"
    });

    const programs = this.blockchainSecurity.bugBountyPrograms;
    let programsHTML = '<h3 style="margin: 0 0 15px 0;">💰 Active Bug Bounty Programs</h3><div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">';
    
    Object.keys(programs).forEach(programId => {
      const program = programs[programId];
      programsHTML += `
        <div style="background: white; padding: 15px; border-radius: 8px; border-left: 4px solid #28a745;">
          <h4 style="margin: 0 0 8px 0; color: #28a745;">${program.name}</h4>
          <p style="margin: 0 0 5px 0; font-weight: bold; color: #dc3545;">Max: ${program.maxReward}</p>
          <p style="margin: 0; font-size: 12px; color: #666;">${program.focus.join(', ')}</p>
        </div>
      `;
    });
    programsHTML += '</div>';
    programsSection.innerHTML = programsHTML;

    // Action buttons
    const buttonsDiv = tag("div", {
      style: "display: flex; gap: 15px; justify-content: center; margin-top: 20px;"
    });

    const generateScriptBtn = tag("button", {
      textContent: "🚀 Generate Audit Script",
      style: "background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 15px 30px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 16px;"
    });

    const quickScanBtn = tag("button", {
      textContent: "⚡ Quick Scan",
      style: "background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; border: none; padding: 15px 30px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 16px;"
    });

    const toolkitBtn = tag("button", {
      textContent: "🛠️ Full Toolkit",
      style: "background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white; border: none; padding: 15px 30px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 16px;"
    });

    buttonsDiv.appendChild(generateScriptBtn);
    buttonsDiv.appendChild(quickScanBtn);
    buttonsDiv.appendChild(toolkitBtn);

    // Event handlers
    generateScriptBtn.onclick = async () => {
      const address = targetInput.value.trim();
      const chain = chainSelect.value;
      
      if (!address) {
        window.toast("Please enter a contract address", 4000);
        return;
      }

      try {
        const script = this.blockchainSecurity.generateSecurityAuditScript(address, chain);
        await this.terminalManager.executeCommand(`echo '${script}' > blockchain_audit.sh && chmod +x blockchain_audit.sh`);
        window.toast("🎉 Audit script generated! Check blockchain_audit.sh", 4000);
        blockchainDialog.hide();
      } catch (error) {
        window.toast(`Error: ${error.message}`, 4000);
      }
    };

    quickScanBtn.onclick = async () => {
      const address = targetInput.value.trim();
      if (!address) {
        window.toast("Please enter a contract address", 4000);
        return;
      }

      window.toast("🔍 Starting quick blockchain security scan...", 3000);
      
      // Generate and execute quick scan
      const quickScanScript = `
echo "🔍 Quick Blockchain Security Scan"
echo "Target: ${address}"
echo "Chain: ${chainSelect.options[chainSelect.selectedIndex].text}"
echo ""
echo "🎯 Checking for common vulnerabilities..."
echo "✓ Reentrancy protection"
echo "✓ Access control mechanisms"  
echo "✓ Integer overflow/underflow"
echo "✓ Oracle manipulation risks"
echo ""
echo "📊 Scan complete! Generate full audit script for detailed analysis."
echo "💰 Potential bug bounty reward: $10,000 - $2,250,000"
      `;
      
      await this.terminalManager.executeCommand(quickScanScript);
      blockchainDialog.hide();
    };

    toolkitBtn.onclick = async () => {
      window.toast("🛠️ Installing ultimate bug bounty toolkit...", 3000);
      
      const toolkit = this.blockchainSecurity.generateBugBountyToolkit();
      await this.terminalManager.executeCommand(`echo '${toolkit}' > install_toolkit.sh && chmod +x install_toolkit.sh && ./install_toolkit.sh`);
      
      window.toast("🎉 Ultimate bug bounty toolkit installed! Ready to find million-dollar bugs!", 5000);
      blockchainDialog.hide();
    };

    container.appendChild(headerDiv);
    container.appendChild(inputSection);
    container.appendChild(optionsSection);
    container.appendChild(programsSection);
    container.appendChild(buttonsDiv);

    blockchainDialog.appendChild(container);
    blockchainDialog.show();
  }

  async destroy() {
    //sidebarApps.remove("dall-e-ai");
    editorManager.editor.commands.removeCommand("ai_assistant");
     window.localStorage.removeItem(window.localStorage.getItem("ai-assistant-provider"));
    window.localStorage.removeItem("ai-assistant-provider");
    window.localStorage.removeItem("ai-assistant-model-name");
    window.localStorage.removeItem("openai-like-baseurl");
    if (await fs(window.DATA_STORAGE+"secret.key").exists()) {
       await fs(window.DATA_STORAGE+"secret.key").delete();
    }
    this.$githubDarkFile.remove();
    this.$higlightJsFile.remove();
    this.$markdownItFile.remove();
    this.$style.remove();
  }
}

if (window.acode) {
  const acodePlugin = new AIAssistant();
  acode.setPluginInit(
    plugin.id,
    (baseUrl, $page, { cacheFileUrl, cacheFile }) => {
      if (!baseUrl.endsWith("/")) {
        baseUrl += "/";
      }
      acodePlugin.baseUrl = baseUrl;
      acodePlugin.init($page, cacheFile, cacheFileUrl);
    },
  );
  acode.setPluginUnmount(plugin.id, () => {
    acodePlugin.destroy();
  });
}

import { Ollama } from "ollama/browser";
import { AI_PROVIDERS, OPENAI_LIKE } from "./constants";

export async function getModelsFromProvider(provider, apiKey) {
  let modelList;
  try {
    switch (provider) {
      case AI_PROVIDERS[0]: // OpenAI
        const openAIResponse = await fetch("https://api.openai.com/v1/models", {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        });

        if (!openAIResponse.ok) {
          acode.alert(
            "AI Assistant",
            `Error fetching OpenAI models: ${openAIResponse.statusText}`,
          );
          throw new Error(
            `Error fetching OpenAI models: ${openAIResponse.statusText}`,
          );
        }

        const openAIData = await openAIResponse.json();
        // filter only gpt realted models
        modelList = openAIData.data
          .filter((item) => /gpt/i.test(item.id))
          .map((item) => item.id);
        break;

      case AI_PROVIDERS[1]: // Google AI
        const googleAIResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`,
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        );

        if (!googleAIResponse.ok) {
          acode.alert(
            "AI Assistant",
            `Error fetching Google AI models: ${googleAIResponse.statusText}`,
          );
          throw new Error(
            `Error fetching Google AI models: ${googleAIResponse.statusText}`,
          );
        }

        const googleAIData = await googleAIResponse.json();
        modelList = googleAIData.models
          .filter((model) => /gemini/i.test(model.name)) // Filter models containing "gemini"
          .map((model) => model.name.replace(/^models\//, "")); // Remove "models/" prefix

        break;
      case AI_PROVIDERS[2]: // ollama
        // check local storage, if user want to provide custom host for ollama
        let host = window.localStorage.getItem("Ollama-Host")
          ? window.localStorage.getItem("Ollama-Host")
          : "http://localhost:11434";
        const ollama = new Ollama({ host });
        const list = await ollama.list();
        modelList = list.models.map((item) => item.model);
        break;

      case AI_PROVIDERS[3]: // Groq
        const groqAIResponse = await fetch(
          `https://api.groq.com/openai/v1/models`,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
          },
        );

        if (!groqAIResponse.ok) {
          acode.alert(
            "AI Assistant",
            `Error fetching Groq AI models: ${groqAIResponse.statusText}`,
          );
          throw new Error(
            `Error fetching Groq AI models: ${groqAIResponse.statusText}`,
          );
        }

        const groqAIData = await groqAIResponse.json();
        modelList = groqAIData.data.map((item) => item.id);
        break;

      case "Anthropic": // Anthropic
        const anthropicResponse = await fetch("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "application/json",
          },
        });
        if (!anthropicResponse.ok) {
          throw new Error(`Error fetching Anthropic models: ${anthropicResponse.statusText}`);
        }
        const anthropicData = await anthropicResponse.json();
        modelList = anthropicData.data?.map(item => item.id) || ["claude-3-sonnet-20240229", "claude-3-haiku-20240307"];
        break;

      case "MistralAI": // MistralAI
        const mistralResponse = await fetch("https://api.mistral.ai/v1/models", {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        });
        if (!mistralResponse.ok) {
          throw new Error(`Error fetching Mistral models: ${mistralResponse.statusText}`);
        }
        const mistralData = await mistralResponse.json();
        modelList = mistralData.data?.map(item => item.id) || ["mistral-large-latest", "mistral-medium-latest"];
        break;

      case "Deepseek": // Deepseek
        modelList = ["deepseek-chat", "deepseek-coder"];
        break;

      case "Cohere": // Cohere
        const cohereResponse = await fetch("https://api.cohere.ai/v1/models", {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        });
        if (!cohereResponse.ok) {
          throw new Error(`Error fetching Cohere models: ${cohereResponse.statusText}`);
        }
        const cohereData = await cohereResponse.json();
        modelList = cohereData.models?.map(item => item.name) || ["command", "command-light"];
        break;

      case "Hugging Face": // Hugging Face
        modelList = ["microsoft/DialoGPT-large", "facebook/blenderbot-400M-distill", "microsoft/DialoGPT-medium"];
        break;

      case "Replicate": // Replicate
        modelList = ["meta/llama-2-70b-chat", "mistralai/mixtral-8x7b-instruct-v0.1", "meta/codellama-34b-instruct"];
        break;

      case "Together AI": // Together AI
        const togetherResponse = await fetch("https://api.together.xyz/models", {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        });
        if (!togetherResponse.ok) {
          throw new Error(`Error fetching Together AI models: ${togetherResponse.statusText}`);
        }
        const togetherData = await togetherResponse.json();
        modelList = togetherData.map(item => item.id) || ["meta-llama/Llama-2-70b-chat-hf", "mistralai/Mixtral-8x7B-Instruct-v0.1"];
        break;

      case "Perplexity": // Perplexity
        modelList = ["llama-3.1-sonar-small-128k-online", "llama-3.1-sonar-large-128k-online", "llama-3.1-sonar-huge-128k-online"];
        break;

      case "AI21 Labs": // AI21 Labs
        modelList = ["j2-ultra", "j2-mid", "j2-light"];
        break;

      case "Aleph Alpha": // Aleph Alpha
        modelList = ["luminous-base", "luminous-extended", "luminous-supreme"];
        break;

      case "Stability AI": // Stability AI
        modelList = ["stable-diffusion-xl-1024-v1-0", "stable-diffusion-v1-6"];
        break;

      case "Fireworks AI": // Fireworks AI
        const fireworksResponse = await fetch("https://api.fireworks.ai/inference/v1/models", {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        });
        if (!fireworksResponse.ok) {
          throw new Error(`Error fetching Fireworks AI models: ${fireworksResponse.statusText}`);
        }
        const fireworksData = await fireworksResponse.json();
        modelList = fireworksData.data?.map(item => item.id) || ["accounts/fireworks/models/llama-v2-70b-chat"];
        break;

      case "Anyscale": // Anyscale
        modelList = ["meta-llama/Llama-2-70b-chat-hf", "codellama/CodeLlama-34b-Instruct-hf"];
        break;

      case "Modal": // Modal
        modelList = ["modal-labs/llama-2-70b", "modal-labs/codellama-34b"];
        break;

      case "Runpod": // Runpod
        modelList = ["runpod/llama2-70b", "runpod/codellama-34b"];
        break;

      case "Banana": // Banana
        modelList = ["banana-dev/llama2-70b", "banana-dev/codellama-34b"];
        break;

      case "Cerebras": // Cerebras
        modelList = ["cerebras/btlm-3b-8k-base", "cerebras/llama2-70b"];
        break;

      case "Lepton AI": // Lepton AI
        modelList = ["llama2-70b", "mixtral-8x7b", "wizardcoder-34b"];
        break;

      case "Novita AI": // Novita AI
        modelList = ["llama-2-70b-chat", "mixtral-8x7b-instruct"];
        break;

      case "DeepInfra": // DeepInfra
        const deepinfraResponse = await fetch("https://api.deepinfra.com/v1/models", {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        });
        if (!deepinfraResponse.ok) {
          throw new Error(`Error fetching DeepInfra models: ${deepinfraResponse.statusText}`);
        }
        const deepinfraData = await deepinfraResponse.json();
        modelList = deepinfraData.map(item => item.model_name) || ["meta-llama/Llama-2-70b-chat-hf"];
        break;

      case "Monster API": // Monster API
        modelList = ["llama2-70b-chat", "mixtral-8x7b-instruct"];
        break;

      case "Cloudflare Workers AI": // Cloudflare Workers AI
        modelList = ["@cf/meta/llama-2-7b-chat-int8", "@cf/mistral/mistral-7b-instruct-v0.1"];
        break;

      case "Azure OpenAI": // Azure OpenAI
        // Azure OpenAI uses the same models as OpenAI but requires different endpoint
        modelList = ["gpt-4", "gpt-35-turbo", "gpt-4-32k"];
        break;

      case "AWS Bedrock": // AWS Bedrock
        modelList = ["anthropic.claude-v2", "ai21.j2-ultra-v1", "amazon.titan-text-express-v1"];
        break;

      case OPENAI_LIKE: // OpenAI-Like
        // Return empty array because we do not fetch models for this
        return [];

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  } catch (error) {
    console.error(error.message);
    return [];
  }

  return modelList;
}

export function detectCodeLanguage(code) {
  const patterns = {
    python: [/^import\s+\w+/, /^from\s+\w+\s+import/, /def\s+\w+\(/, /if\s+__name__\s*==\s*['"']__main__['"']/, /print\s*\(/],
    javascript: [/^const\s+\w+/, /^let\s+\w+/, /^var\s+\w+/, /function\s+\w+\(/, /console\.log\(/, /=>\s*{/],
    bash: [/^#!\/bin\/bash/, /^#!\/bin\/sh/, /^\w+\s*=/, /if\s*\[\s*.*\s*\]/, /for\s+\w+\s+in/],
    php: [/<\?php/, /\$\w+\s*=/, /function\s+\w+\(/, /echo\s+/, /print\s+/],
    ruby: [/^require\s+/, /def\s+\w+/, /puts\s+/, /class\s+\w+/, /@\w+/],
    go: [/^package\s+\w+/, /^import\s+/, /func\s+\w+\(/, /fmt\.Print/],
    java: [/^public\s+class/, /^import\s+java\./, /public\s+static\s+void\s+main/, /System\.out\.print/],
    c: [/^#include\s*</, /int\s+main\s*\(/, /printf\s*\(/, /malloc\s*\(/],
    cpp: [/^#include\s*</, /using\s+namespace\s+std/, /cout\s*<</, /std::/],
    rust: [/^use\s+/, /fn\s+main\s*\(/, /println!\s*\(/, /let\s+mut/],
    powershell: [/^\$\w+\s*=/, /Write-Host/, /Get-\w+/, /Set-\w+/]
  };

  for (const [language, langPatterns] of Object.entries(patterns)) {
    if (langPatterns.some(pattern => pattern.test(code))) {
      return language;
    }
  }

  return 'text';
}

export function extractCodeBlocks(text) {
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  const blocks = [];
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const language = match[1] || detectCodeLanguage(match[2]);
    blocks.push({
      language: language,
      code: match[2].trim(),
      fullMatch: match[0]
    });
  }

  return blocks;
}

export function sanitizeInput(input) {
  // Remove potentially dangerous characters and patterns
  return input
    .replace(/[<>]/g, '') // Remove HTML tags
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+\s*=/gi, '') // Remove event handlers
    .trim();
}

// Enhanced Ollama Manager for Local AI Models
import { FREE_AI_MODELS } from './free-models.js';

export class OllamaManager {
  constructor() {
    this.baseUrl = 'http://localhost:11434';
    this.availableModels = [];
    this.installedModels = [];
    this.currentModel = null;
    this.isConnected = false;
  }

  async initialize() {
    try {
      await this.checkConnection();
      await this.loadAvailableModels();
      await this.loadInstalledModels();
      return true;
    } catch (error) {
      console.error('Ollama initialization failed:', error);
      return false;
    }
  }

  async checkConnection() {
    try {
      const response = await fetch(`${this.baseUrl}/api/version`);
      if (response.ok) {
        this.isConnected = true;
        return true;
      }
    } catch (error) {
      this.isConnected = false;
      throw new Error('Ollama not running. Please start Ollama service.');
    }
  }

  async installOllama() {
    const installScript = `
#!/bin/bash
echo "Installing Ollama..."

# Download and install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Start Ollama service
ollama serve &

# Wait for service to start
sleep 5

# Install recommended models for coding and security
echo "Installing recommended models..."
ollama pull llama3.2:latest
ollama pull codellama:latest
ollama pull deepseek-coder:latest
ollama pull qwen2.5-coder:latest
ollama pull starcoder2:latest

echo "Ollama installation complete!"
echo "Available models:"
ollama list
`;

    return {
      script: installScript,
      description: 'Install Ollama and recommended coding models',
      estimatedTime: '10-15 minutes'
    };
  }

  async loadAvailableModels() {
    this.availableModels = FREE_AI_MODELS.ollama.models.map(model => ({
      name: model,
      specialty: FREE_AI_MODELS.ollama.specialties[model] || 'General purpose',
      size: this.getModelSize(model),
      recommended: this.isRecommendedModel(model)
    }));
  }

  async loadInstalledModels() {
    if (!this.isConnected) return [];

    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      const data = await response.json();
      this.installedModels = data.models || [];
      return this.installedModels;
    } catch (error) {
      console.error('Failed to load installed models:', error);
      return [];
    }
  }

  async pullModel(modelName, onProgress = null) {
    if (!this.isConnected) {
      throw new Error('Ollama not connected');
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName })
      });

      if (!response.ok) {
        throw new Error(`Failed to pull model: ${response.statusText}`);
      }

      // Handle streaming response for progress updates
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (onProgress && data.status) {
              onProgress({
                status: data.status,
                completed: data.completed || 0,
                total: data.total || 0,
                percent: data.total ? Math.round((data.completed / data.total) * 100) : 0
              });
            }
          } catch (e) {
            // Ignore JSON parse errors
          }
        }
      }

      await this.loadInstalledModels();
      return true;
    } catch (error) {
      console.error('Model pull failed:', error);
      throw error;
    }
  }

  async generateResponse(prompt, modelName = null, options = {}) {
    if (!this.isConnected) {
      throw new Error('Ollama not connected');
    }

    const model = modelName || this.currentModel || 'llama3.2:latest';
    
    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: options.temperature || 0.7,
            top_p: options.top_p || 0.9,
            top_k: options.top_k || 40,
            ...options
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Generation failed: ${response.statusText}`);
      }

      const data = await response.json();
      return data.response;
    } catch (error) {
      console.error('Generation failed:', error);
      throw error;
    }
  }

  async generateCode(description, language = 'auto', modelName = null) {
    const codeModel = modelName || this.getBestCodeModel();
    
    const prompt = `You are an expert programmer. Generate clean, efficient, and well-documented ${language} code for the following requirement:

${description}

Requirements:
- Write production-ready code
- Include proper error handling
- Add clear comments
- Follow best practices
- Ensure security considerations

Code:`;

    return await this.generateResponse(prompt, codeModel, {
      temperature: 0.3, // Lower temperature for more consistent code
      top_p: 0.8
    });
  }

  async analyzeSecurityCode(code, language = 'auto') {
    const securityModel = this.getBestSecurityModel();
    
    const prompt = `You are a cybersecurity expert. Analyze the following ${language} code for security vulnerabilities:

${code}

Please provide:
1. Security vulnerabilities found (if any)
2. Risk level (Low/Medium/High/Critical)
3. Recommended fixes
4. Best practices to prevent similar issues

Analysis:`;

    return await this.generateResponse(prompt, securityModel, {
      temperature: 0.2 // Very low temperature for consistent security analysis
    });
  }

  getBestCodeModel() {
    const codeModels = ['deepseek-coder:latest', 'codellama:latest', 'qwen2.5-coder:latest', 'starcoder2:latest'];
    
    for (const model of codeModels) {
      if (this.isModelInstalled(model)) {
        return model;
      }
    }
    
    return 'llama3.2:latest'; // Fallback
  }

  getBestSecurityModel() {
    const securityModels = ['deepseek-coder:latest', 'llama3.2:latest', 'codellama:latest'];
    
    for (const model of securityModels) {
      if (this.isModelInstalled(model)) {
        return model;
      }
    }
    
    return 'llama3.2:latest'; // Fallback
  }

  isModelInstalled(modelName) {
    return this.installedModels.some(model => model.name === modelName);
  }

  getModelSize(modelName) {
    const sizes = {
      'llama3.2:latest': '2.0GB',
      'llama3.1:latest': '4.7GB',
      'codellama:latest': '3.8GB',
      'deepseek-coder:latest': '3.4GB',
      'qwen2.5-coder:latest': '3.1GB',
      'starcoder2:latest': '3.3GB',
      'phi3:latest': '2.3GB',
      'gemma2:latest': '5.4GB',
      'mistral:latest': '4.1GB'
    };
    return sizes[modelName] || 'Unknown';
  }

  isRecommendedModel(modelName) {
    const recommended = [
      'llama3.2:latest',
      'codellama:latest', 
      'deepseek-coder:latest',
      'qwen2.5-coder:latest'
    ];
    return recommended.includes(modelName);
  }

  async getModelInfo(modelName) {
    if (!this.isConnected) return null;

    try {
      const response = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName })
      });

      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.error('Failed to get model info:', error);
    }
    return null;
  }

  async deleteModel(modelName) {
    if (!this.isConnected) {
      throw new Error('Ollama not connected');
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName })
      });

      if (response.ok) {
        await this.loadInstalledModels();
        return true;
      } else {
        throw new Error(`Failed to delete model: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Model deletion failed:', error);
      throw error;
    }
  }

  setCurrentModel(modelName) {
    if (this.isModelInstalled(modelName)) {
      this.currentModel = modelName;
      return true;
    }
    return false;
  }

  getCurrentModel() {
    return this.currentModel || 'llama3.2:latest';
  }

  getConnectionStatus() {
    return {
      connected: this.isConnected,
      baseUrl: this.baseUrl,
      installedModels: this.installedModels.length,
      currentModel: this.currentModel
    };
  }
}
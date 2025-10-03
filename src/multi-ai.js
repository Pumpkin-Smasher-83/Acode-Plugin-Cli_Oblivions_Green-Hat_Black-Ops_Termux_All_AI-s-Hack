import { AI_PROVIDERS, multiAiIconSvg } from "./constants";
import { v4 as uuidv4 } from "uuid";

export class MultiAIManager {
  constructor(apiKeyManager) {
    this.apiKeyManager = apiKeyManager;
    this.activeAIs = [];
    this.maxActiveAIs = 3;
    this.conversations = new Map();
    this.consensusMode = false;
    this.votingEnabled = false;
  }

  async addAI(providerName, modelName, apiKey) {
    if (this.activeAIs.length >= this.maxActiveAIs) {
      throw new Error(`Maximum ${this.maxActiveAIs} AIs can be active simultaneously`);
    }

    if (this.activeAIs.some(ai => ai.provider === providerName && ai.model === modelName)) {
      throw new Error('This AI model is already active');
    }

    const aiInstance = {
      id: uuidv4(),
      provider: providerName,
      model: modelName,
      apiKey: apiKey,
      modelInstance: null,
      isActive: true,
      responseTime: 0,
      accuracy: 0,
      specialization: this.getAISpecialization(providerName, modelName)
    };

    // Initialize the model instance
    aiInstance.modelInstance = await this.initializeModel(providerName, modelName, apiKey);
    
    this.activeAIs.push(aiInstance);
    return aiInstance;
  }

  async removeAI(aiId) {
    const index = this.activeAIs.findIndex(ai => ai.id === aiId);
    if (index === -1) {
      throw new Error('AI not found');
    }

    this.activeAIs.splice(index, 1);
    this.conversations.delete(aiId);
  }

  getAISpecialization(provider, model) {
    const specializations = {
      'OpenAI': {
        'gpt-4': ['general', 'coding', 'analysis'],
        'gpt-3.5-turbo': ['general', 'conversation'],
        'code-davinci': ['coding', 'debugging']
      },
      'Google': {
        'gemini-pro': ['general', 'multimodal', 'analysis'],
        'gemini-pro-vision': ['vision', 'image-analysis']
      },
      'Anthropic': {
        'claude-3': ['reasoning', 'analysis', 'safety'],
        'claude-instant': ['conversation', 'general']
      },
      'Groq': {
        'mixtral': ['fast-inference', 'general'],
        'llama2': ['open-source', 'general']
      },
      'Cohere': {
        'command': ['text-generation', 'summarization'],
        'embed': ['embeddings', 'search']
      }
    };

    return specializations[provider]?.[model] || ['general'];
  }

  async initializeModel(providerName, modelName, apiKey) {
    // This would use the same initialization logic from main.js
    // For now, return a placeholder
    return {
      provider: providerName,
      model: modelName,
      initialized: true
    };
  }

  async queryAllAIs(prompt, options = {}) {
    if (this.activeAIs.length === 0) {
      throw new Error('No active AIs available');
    }

    const responses = await Promise.allSettled(
      this.activeAIs.map(async (ai) => {
        const startTime = Date.now();
        try {
          const response = await this.queryAI(ai.id, prompt, options);
          const endTime = Date.now();
          ai.responseTime = endTime - startTime;
          return {
            aiId: ai.id,
            provider: ai.provider,
            model: ai.model,
            response: response,
            responseTime: ai.responseTime,
            specialization: ai.specialization,
            status: 'fulfilled'
          };
        } catch (error) {
          return {
            aiId: ai.id,
            provider: ai.provider,
            model: ai.model,
            error: error.message,
            status: 'rejected'
          };
        }
      })
    );

    return responses.map((result, index) => ({
      ...result.value || { error: result.reason },
      aiIndex: index
    }));
  }

  async queryAI(aiId, prompt, options = {}) {
    const ai = this.activeAIs.find(a => a.id === aiId);
    if (!ai) {
      throw new Error('AI not found');
    }

    // Store conversation history
    if (!this.conversations.has(aiId)) {
      this.conversations.set(aiId, []);
    }

    const conversation = this.conversations.get(aiId);
    conversation.push({ role: 'user', content: prompt, timestamp: new Date().toISOString() });

    // Simulate AI response - in real implementation, this would call the actual AI
    const response = await this.simulateAIResponse(ai, prompt, options);
    
    conversation.push({ role: 'assistant', content: response, timestamp: new Date().toISOString() });
    
    return response;
  }

  async simulateAIResponse(ai, prompt, options) {
    // This is a placeholder - in real implementation, use the actual AI model
    const responses = {
      'OpenAI': `OpenAI (${ai.model}) response to: ${prompt}`,
      'Google': `Google Gemini response to: ${prompt}`,
      'Anthropic': `Claude response with careful analysis: ${prompt}`,
      'Groq': `Groq fast response: ${prompt}`,
      'Ollama': `Local Ollama response: ${prompt}`
    };

    // Add some delay to simulate real API calls
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 500));
    
    return responses[ai.provider] || `${ai.provider} response to: ${prompt}`;
  }

  async getConsensus(prompt, options = {}) {
    if (this.activeAIs.length < 2) {
      throw new Error('At least 2 AIs required for consensus');
    }

    const responses = await this.queryAllAIs(prompt, options);
    const validResponses = responses.filter(r => r.status !== 'rejected');

    if (validResponses.length === 0) {
      throw new Error('No valid responses received');
    }

    // Simple consensus algorithm - in practice, this would be more sophisticated
    const consensus = {
      prompt: prompt,
      responses: validResponses,
      agreement_score: this.calculateAgreementScore(validResponses),
      consensus_response: this.generateConsensusResponse(validResponses),
      dissenting_opinions: this.findDissentingOpinions(validResponses),
      confidence: this.calculateConfidence(validResponses)
    };

    return consensus;
  }

  calculateAgreementScore(responses) {
    if (responses.length < 2) return 1.0;

    // Simple similarity check - in practice, use semantic similarity
    const responseTexts = responses.map(r => r.response.toLowerCase());
    let agreements = 0;
    let comparisons = 0;

    for (let i = 0; i < responseTexts.length; i++) {
      for (let j = i + 1; j < responseTexts.length; j++) {
        comparisons++;
        // Simple word overlap check
        const words1 = new Set(responseTexts[i].split(' '));
        const words2 = new Set(responseTexts[j].split(' '));
        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);
        const similarity = intersection.size / union.size;
        
        if (similarity > 0.3) { // 30% similarity threshold
          agreements++;
        }
      }
    }

    return comparisons > 0 ? agreements / comparisons : 0;
  }

  generateConsensusResponse(responses) {
    // Simple approach - return the most common elements
    // In practice, this would use more sophisticated NLP
    const allWords = responses.flatMap(r => r.response.split(' '));
    const wordCounts = {};
    
    allWords.forEach(word => {
      wordCounts[word] = (wordCounts[word] || 0) + 1;
    });

    const commonWords = Object.entries(wordCounts)
      .filter(([word, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => word);

    return `Consensus based on ${responses.length} AI responses: ${commonWords.join(' ')}`;
  }

  findDissentingOpinions(responses) {
    // Identify responses that significantly differ from others
    return responses.filter((response, index) => {
      const otherResponses = responses.filter((_, i) => i !== index);
      const similarity = this.calculateResponseSimilarity(response.response, otherResponses);
      return similarity < 0.3; // Less than 30% similarity
    });
  }

  calculateResponseSimilarity(response, otherResponses) {
    if (otherResponses.length === 0) return 1.0;

    const responseWords = new Set(response.toLowerCase().split(' '));
    let totalSimilarity = 0;

    otherResponses.forEach(other => {
      const otherWords = new Set(other.response.toLowerCase().split(' '));
      const intersection = new Set([...responseWords].filter(x => otherWords.has(x)));
      const union = new Set([...responseWords, ...otherWords]);
      totalSimilarity += intersection.size / union.size;
    });

    return totalSimilarity / otherResponses.length;
  }

  calculateConfidence(responses) {
    const agreementScore = this.calculateAgreementScore(responses);
    const responseCount = responses.length;
    const avgResponseTime = responses.reduce((sum, r) => sum + (r.responseTime || 0), 0) / responseCount;
    
    // Confidence based on agreement, number of responses, and response time
    let confidence = agreementScore * 0.6; // Agreement weight: 60%
    confidence += Math.min(responseCount / this.maxActiveAIs, 1) * 0.3; // Response count weight: 30%
    confidence += Math.max(0, 1 - avgResponseTime / 10000) * 0.1; // Response time weight: 10%
    
    return Math.min(confidence, 1.0);
  }

  async voteOnResponse(responses, criteria = 'accuracy') {
    if (!this.votingEnabled) {
      throw new Error('Voting is not enabled');
    }

    const votes = responses.map(response => ({
      ...response,
      votes: 0,
      score: this.scoreResponse(response, criteria)
    }));

    // Sort by score
    votes.sort((a, b) => b.score - a.score);

    return {
      winner: votes[0],
      ranking: votes,
      criteria: criteria
    };
  }

  scoreResponse(response, criteria) {
    let score = 0;

    switch (criteria) {
      case 'accuracy':
        // Score based on response length and complexity
        score = Math.min(response.response.length / 1000, 1) * 0.5;
        score += (response.specialization.includes('analysis') ? 0.3 : 0);
        score += (response.responseTime < 5000 ? 0.2 : 0);
        break;
      
      case 'speed':
        score = Math.max(0, 1 - response.responseTime / 10000);
        break;
      
      case 'creativity':
        // Simple creativity measure based on unique words
        const words = response.response.split(' ');
        const uniqueWords = new Set(words);
        score = uniqueWords.size / words.length;
        break;
      
      default:
        score = 0.5; // Default score
    }

    return Math.min(score, 1.0);
  }

  getActiveAIs() {
    return this.activeAIs.map(ai => ({
      id: ai.id,
      provider: ai.provider,
      model: ai.model,
      specialization: ai.specialization,
      responseTime: ai.responseTime,
      isActive: ai.isActive
    }));
  }

  async enableConsensusMode() {
    this.consensusMode = true;
  }

  async disableConsensusMode() {
    this.consensusMode = false;
  }

  async enableVoting() {
    this.votingEnabled = true;
  }

  async disableVoting() {
    this.votingEnabled = false;
  }

  getConversationHistory(aiId) {
    return this.conversations.get(aiId) || [];
  }

  clearConversationHistory(aiId) {
    if (aiId) {
      this.conversations.delete(aiId);
    } else {
      this.conversations.clear();
    }
  }

  async generateCodeWithMultipleAIs(description, language = 'python') {
    const prompt = `Generate ${language} code for: ${description}. Provide clean, well-commented code that follows best practices.`;
    
    const responses = await this.queryAllAIs(prompt, { 
      context: 'code_generation',
      language: language 
    });

    const codeResponses = responses.filter(r => r.status !== 'rejected');
    
    if (codeResponses.length === 0) {
      throw new Error('No code responses received');
    }

    // Return the best code based on voting
    const voted = await this.voteOnResponse(codeResponses, 'accuracy');
    
    return {
      best_code: voted.winner,
      all_responses: codeResponses,
      consensus: await this.getConsensus(prompt),
      language: language
    };
  }
}
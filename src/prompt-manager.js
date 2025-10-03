// Custom Prompt Manager for Fine-Tuning AI Responses
import { CUSTOM_PROMPTS } from './free-models.js';

export class PromptManager {
  constructor() {
    this.customPrompts = new Map();
    this.activePrompt = null;
    this.promptHistory = [];
    this.loadSavedPrompts();
  }

  // Load saved prompts from localStorage
  loadSavedPrompts() {
    try {
      const saved = localStorage.getItem('acode-ai-custom-prompts');
      if (saved) {
        const prompts = JSON.parse(saved);
        Object.entries(prompts).forEach(([key, value]) => {
          this.customPrompts.set(key, value);
        });
      }

      // Load default prompts
      Object.entries(CUSTOM_PROMPTS).forEach(([key, value]) => {
        if (!this.customPrompts.has(key)) {
          this.customPrompts.set(key, value);
        }
      });
    } catch (error) {
      console.error('Failed to load saved prompts:', error);
    }
  }

  // Save prompts to localStorage
  savePrompts() {
    try {
      const promptsObj = Object.fromEntries(this.customPrompts);
      localStorage.setItem('acode-ai-custom-prompts', JSON.stringify(promptsObj));
    } catch (error) {
      console.error('Failed to save prompts:', error);
    }
  }

  // Add or update a custom prompt
  addPrompt(id, name, prompt, category = 'custom', isSystem = true) {
    const promptData = {
      id,
      name,
      prompt,
      category,
      isSystem,
      created: new Date().toISOString(),
      lastUsed: null,
      useCount: 0
    };

    this.customPrompts.set(id, promptData);
    this.savePrompts();
    return promptData;
  }

  // Get a prompt by ID
  getPrompt(id) {
    return this.customPrompts.get(id);
  }

  // Get all prompts, optionally filtered by category
  getAllPrompts(category = null) {
    const prompts = Array.from(this.customPrompts.values());
    if (category) {
      return prompts.filter(p => p.category === category);
    }
    return prompts;
  }

  // Delete a prompt
  deletePrompt(id) {
    const deleted = this.customPrompts.delete(id);
    if (deleted) {
      this.savePrompts();
    }
    return deleted;
  }

  // Set active prompt for current session
  setActivePrompt(id) {
    const prompt = this.customPrompts.get(id);
    if (prompt) {
      this.activePrompt = prompt;
      prompt.lastUsed = new Date().toISOString();
      prompt.useCount++;
      this.savePrompts();
      return true;
    }
    return false;
  }

  // Get active prompt
  getActivePrompt() {
    return this.activePrompt;
  }

  // Clear active prompt
  clearActivePrompt() {
    this.activePrompt = null;
  }

  // Build complete prompt with system prompt + user message
  buildCompletePrompt(userMessage, includeDisclaimer = false) {
    let completePrompt = '';

    // Add system prompt if active
    if (this.activePrompt && this.activePrompt.isSystem) {
      completePrompt += this.activePrompt.prompt + '\n\n';
    }

    // Add legal disclaimer if requested
    if (includeDisclaimer) {
      completePrompt += this.getLegalDisclaimer() + '\n\n';
    }

    // Add user message
    completePrompt += `User: ${userMessage}\n\nAssistant: `;

    return completePrompt;
  }

  // Get legal disclaimer (placeholder for attorney-written content)
  getLegalDisclaimer() {
    return `LEGAL DISCLAIMER: This AI assistant is provided for educational and authorized security testing purposes only. Users must:

1. Only test systems they own or have explicit written permission to test
2. Comply with all applicable laws and regulations
3. Follow responsible disclosure practices
4. Not use this tool for malicious purposes
5. Understand that unauthorized access to computer systems is illegal

By using this tool, you acknowledge that you have read, understood, and agree to comply with these terms and all applicable laws. The developers and providers of this tool are not responsible for any misuse or illegal activities conducted by users.

[Attorney-drafted legal language would be inserted here]`;
  }

  // Create specialized prompts for different use cases
  createSecurityPrompt(userLevel = 'basic') {
    const basePrompt = CUSTOM_PROMPTS.security_expert.prompt;
    
    const levelModifications = {
      basic: '\n\nIMPORTANT: Provide educational content only. Always emphasize legal and ethical considerations.',
      professional: '\n\nYou may provide advanced techniques but always within legal and ethical boundaries.',
      expert: '\n\nYou have access to advanced security techniques. Ensure all activities are authorized and legal.'
    };

    return basePrompt + (levelModifications[userLevel] || levelModifications.basic);
  }

  createCodePrompt(language = 'auto', complexity = 'intermediate') {
    let prompt = CUSTOM_PROMPTS.code_architect.prompt;

    const complexityModifications = {
      beginner: '\n\nFocus on simple, well-commented code with detailed explanations.',
      intermediate: '\n\nProvide efficient code with good practices and moderate complexity.',
      advanced: '\n\nCreate sophisticated solutions with advanced patterns and optimizations.',
      expert: '\n\nDevelop enterprise-grade code with comprehensive error handling and scalability.'
    };

    if (language !== 'auto') {
      prompt += `\n\nSpecialize in ${language} development and follow ${language}-specific best practices.`;
    }

    prompt += complexityModifications[complexity] || complexityModifications.intermediate;

    return prompt;
  }

  // Import prompts from file or text
  importPrompts(promptsData) {
    try {
      const prompts = typeof promptsData === 'string' ? JSON.parse(promptsData) : promptsData;
      
      let imported = 0;
      Object.entries(prompts).forEach(([key, value]) => {
        if (value.name && value.prompt) {
          this.addPrompt(key, value.name, value.prompt, value.category || 'imported');
          imported++;
        }
      });

      return { success: true, imported };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Export prompts to JSON
  exportPrompts() {
    const prompts = Object.fromEntries(this.customPrompts);
    return JSON.stringify(prompts, null, 2);
  }

  // Get prompt statistics
  getPromptStats() {
    const prompts = Array.from(this.customPrompts.values());
    
    return {
      total: prompts.length,
      categories: [...new Set(prompts.map(p => p.category))],
      mostUsed: prompts.sort((a, b) => b.useCount - a.useCount).slice(0, 5),
      recentlyUsed: prompts
        .filter(p => p.lastUsed)
        .sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))
        .slice(0, 5)
    };
  }

  // Search prompts by name or content
  searchPrompts(query) {
    const lowercaseQuery = query.toLowerCase();
    return Array.from(this.customPrompts.values()).filter(prompt => 
      prompt.name.toLowerCase().includes(lowercaseQuery) ||
      prompt.prompt.toLowerCase().includes(lowercaseQuery)
    );
  }

  // Create prompt templates for common scenarios
  getPromptTemplates() {
    return {
      bug_bounty: {
        name: 'Bug Bounty Hunter',
        template: `You are a professional bug bounty hunter analyzing {target_type} for security vulnerabilities.

Focus Areas:
- {focus_areas}

Scope: {scope}
Out of Scope: {out_of_scope}

Methodology:
1. Reconnaissance and information gathering
2. Vulnerability identification
3. Exploitation (proof of concept only)
4. Documentation and reporting

Remember: Only test authorized targets with proper scope definition.`,
        variables: ['target_type', 'focus_areas', 'scope', 'out_of_scope']
      },

      code_review: {
        name: 'Code Security Review',
        template: `You are conducting a security code review for {language} code.

Review Focus:
- {security_focus}

Code Quality Standards:
- {quality_standards}

Please analyze the code for:
1. Security vulnerabilities
2. Code quality issues
3. Performance concerns
4. Best practice violations

Provide specific recommendations for improvement.`,
        variables: ['language', 'security_focus', 'quality_standards']
      },

      app_builder: {
        name: 'AI App Builder',
        template: `You are an expert app developer creating a {app_type} application.

Requirements:
{requirements}

Technical Stack:
- Frontend: {frontend}
- Backend: {backend}
- Database: {database}

Features to implement:
{features}

Create production-ready code with proper architecture, error handling, and security considerations.`,
        variables: ['app_type', 'requirements', 'frontend', 'backend', 'database', 'features']
      }
    };
  }

  // Fill template with variables
  fillTemplate(templateId, variables) {
    const templates = this.getPromptTemplates();
    const template = templates[templateId];
    
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    let filledPrompt = template.template;
    
    Object.entries(variables).forEach(([key, value]) => {
      const placeholder = `{${key}}`;
      filledPrompt = filledPrompt.replace(new RegExp(placeholder, 'g'), value);
    });

    return {
      name: template.name,
      prompt: filledPrompt,
      category: 'generated'
    };
  }
}
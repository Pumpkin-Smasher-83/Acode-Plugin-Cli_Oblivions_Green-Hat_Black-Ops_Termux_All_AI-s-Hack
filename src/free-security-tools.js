// Free Security Tools Manager - No API Keys Required
import { FREE_SECURITY_TOOLS } from './free-models.js';

export class FreeSecurityToolsManager {
  constructor(terminalManager) {
    this.terminal = terminalManager;
    this.installedTools = new Set();
    this.toolCategories = FREE_SECURITY_TOOLS;
    this.loadInstalledTools();
  }

  // Load list of installed tools from localStorage
  loadInstalledTools() {
    try {
      const installed = localStorage.getItem('acode-ai-installed-tools');
      if (installed) {
        this.installedTools = new Set(JSON.parse(installed));
      }
    } catch (error) {
      console.error('Failed to load installed tools:', error);
    }
  }

  // Save installed tools list
  saveInstalledTools() {
    try {
      localStorage.setItem('acode-ai-installed-tools', JSON.stringify([...this.installedTools]));
    } catch (error) {
      console.error('Failed to save installed tools:', error);
    }
  }

  // Check if a tool is installed
  isToolInstalled(toolName) {
    return this.installedTools.has(toolName);
  }

  // Mark tool as installed
  markToolInstalled(toolName) {
    this.installedTools.add(toolName);
    this.saveInstalledTools();
  }

  // Get all tools by category
  getToolsByCategory(category) {
    return this.toolCategories[category]?.tools || [];
  }

  // Get all categories
  getCategories() {
    return Object.keys(this.toolCategories);
  }

  // Install a specific tool
  async installTool(toolName, category) {
    const tools = this.getToolsByCategory(category);
    const tool = tools.find(t => t.name === toolName);
    
    if (!tool) {
      throw new Error(`Tool ${toolName} not found in category ${category}`);
    }

    try {
      // Show installation progress
      await this.terminal.executeCommand(`echo "Installing ${toolName}..."`);
      
      // Execute installation command
      const result = await this.terminal.executeCommand(tool.install);
      
      if (result.success) {
        this.markToolInstalled(toolName);
        await this.terminal.executeCommand(`echo "${toolName} installed successfully!"`);
        return { success: true, message: `${toolName} installed successfully` };
      } else {
        throw new Error(result.error || 'Installation failed');
      }
    } catch (error) {
      await this.terminal.executeCommand(`echo "Failed to install ${toolName}: ${error.message}"`);
      return { success: false, error: error.message };
    }
  }

  // Install all tools in a category
  async installCategory(category) {
    const tools = this.getToolsByCategory(category);
    const results = [];

    for (const tool of tools) {
      if (!this.isToolInstalled(tool.name)) {
        const result = await this.installTool(tool.name, category);
        results.push({ tool: tool.name, ...result });
      } else {
        results.push({ tool: tool.name, success: true, message: 'Already installed' });
      }
    }

    return results;
  }

  // Run a tool with specified parameters
  async runTool(toolName, parameters = '', category = null) {
    // Find the tool in all categories if category not specified
    let tool = null;
    let foundCategory = category;

    if (category) {
      const tools = this.getToolsByCategory(category);
      tool = tools.find(t => t.name === toolName);
    } else {
      // Search all categories
      for (const [cat, data] of Object.entries(this.toolCategories)) {
        const found = data.tools.find(t => t.name === toolName);
        if (found) {
          tool = found;
          foundCategory = cat;
          break;
        }
      }
    }

    if (!tool) {
      throw new Error(`Tool ${toolName} not found`);
    }

    if (!this.isToolInstalled(toolName)) {
      throw new Error(`Tool ${toolName} is not installed. Install it first.`);
    }

    // Build command
    let command = parameters ? `${toolName} ${parameters}` : tool.usage;
    
    // Add safety warnings for dangerous tools
    if (this.isDangerousTool(toolName)) {
      await this.terminal.executeCommand(`echo "⚠️  WARNING: ${toolName} is a powerful tool. Use responsibly and only on authorized targets."`);
      await this.terminal.executeCommand(`echo "Press Ctrl+C to cancel, or any key to continue..."`);
      // In a real implementation, you'd wait for user input here
    }

    try {
      await this.terminal.executeCommand(`echo "Running: ${command}"`);
      const result = await this.terminal.executeCommand(command);
      return result;
    } catch (error) {
      await this.terminal.executeCommand(`echo "Error running ${toolName}: ${error.message}"`);
      throw error;
    }
  }

  // Check if tool is considered dangerous
  isDangerousTool(toolName) {
    const dangerousTools = [
      'metasploit-framework',
      'sqlmap',
      'hydra',
      'masscan',
      'zmap'
    ];
    return dangerousTools.includes(toolName);
  }

  // Get tool information
  getToolInfo(toolName, category = null) {
    if (category) {
      const tools = this.getToolsByCategory(category);
      return tools.find(t => t.name === toolName);
    }

    // Search all categories
    for (const [cat, data] of Object.entries(this.toolCategories)) {
      const tool = data.tools.find(t => t.name === toolName);
      if (tool) {
        return { ...tool, category: cat };
      }
    }

    return null;
  }

  // Generate installation script for all tools
  generateInstallScript() {
    let script = `#!/bin/bash
# Automated Security Tools Installation Script
# Generated by Acode AI Assistant

echo "Starting security tools installation..."
echo "This may take 15-30 minutes depending on your internet connection."

# Update system
apt-get update

# Install basic dependencies
apt-get install -y curl wget git python3 python3-pip ruby gem

`;

    // Add installation commands for each tool
    Object.entries(this.toolCategories).forEach(([category, data]) => {
      script += `\n# ${data.name} Tools\n`;
      data.tools.forEach(tool => {
        script += `echo "Installing ${tool.name}..."\n`;
        script += `${tool.install}\n`;
        script += `echo "${tool.name} installation complete"\n\n`;
      });
    });

    script += `
echo "All security tools installation complete!"
echo "Available tools:"
`;

    // Add verification commands
    Object.entries(this.toolCategories).forEach(([category, data]) => {
      data.tools.forEach(tool => {
        script += `which ${tool.name} && echo "✓ ${tool.name}" || echo "✗ ${tool.name}"\n`;
      });
    });

    return script;
  }

  // Create tool usage examples
  getToolExamples(toolName) {
    const examples = {
      nmap: [
        'nmap -sV -sC target.com  # Version and script scan',
        'nmap -p- target.com      # Scan all ports',
        'nmap -sU target.com      # UDP scan',
        'nmap --script vuln target.com  # Vulnerability scan'
      ],
      gobuster: [
        'gobuster dir -u http://target.com -w /usr/share/wordlists/dirb/common.txt',
        'gobuster dns -d target.com -w /usr/share/wordlists/subdomains.txt',
        'gobuster vhost -u http://target.com -w /usr/share/wordlists/subdomains.txt'
      ],
      sqlmap: [
        'sqlmap -u "http://target.com/page?id=1" --dbs',
        'sqlmap -u "http://target.com/page?id=1" -D database --tables',
        'sqlmap -u "http://target.com/page?id=1" -D database -T table --dump'
      ],
      nikto: [
        'nikto -h http://target.com',
        'nikto -h http://target.com -p 80,443',
        'nikto -h http://target.com -o report.html -Format htm'
      ],
      hydra: [
        'hydra -l admin -P passwords.txt target.com ssh',
        'hydra -L users.txt -P passwords.txt target.com ftp',
        'hydra -l admin -P passwords.txt target.com http-post-form "/login:user=^USER^&pass=^PASS^:Invalid"'
      ]
    };

    return examples[toolName] || [`${toolName} --help  # Show help information`];
  }

  // Get recommended tool combinations for specific tasks
  getToolCombinations() {
    return {
      web_app_testing: {
        name: 'Web Application Testing',
        tools: ['nmap', 'gobuster', 'nikto', 'sqlmap'],
        workflow: [
          '1. Port scan with nmap',
          '2. Directory enumeration with gobuster',
          '3. Web vulnerability scan with nikto',
          '4. SQL injection testing with sqlmap'
        ]
      },
      network_assessment: {
        name: 'Network Security Assessment',
        tools: ['nmap', 'masscan', 'hydra'],
        workflow: [
          '1. Fast port discovery with masscan',
          '2. Detailed service enumeration with nmap',
          '3. Brute force testing with hydra'
        ]
      },
      wordpress_testing: {
        name: 'WordPress Security Testing',
        tools: ['nmap', 'wpscan', 'gobuster'],
        workflow: [
          '1. Port scan with nmap',
          '2. WordPress-specific scan with wpscan',
          '3. Directory enumeration with gobuster'
        ]
      },
      forensics_analysis: {
        name: 'Digital Forensics Analysis',
        tools: ['volatility3', 'autopsy', 'binwalk'],
        workflow: [
          '1. Memory analysis with volatility3',
          '2. Disk analysis with autopsy',
          '3. Firmware analysis with binwalk'
        ]
      }
    };
  }

  // Generate bug bounty workflow
  generateBugBountyWorkflow(target, scope) {
    return `# Bug Bounty Testing Workflow for ${target}

## Scope
${scope}

## Phase 1: Reconnaissance
1. Subdomain enumeration:
   gobuster dns -d ${target} -w /usr/share/wordlists/subdomains.txt

2. Port scanning:
   nmap -sV -sC ${target}

## Phase 2: Web Application Testing
1. Directory enumeration:
   gobuster dir -u http://${target} -w /usr/share/wordlists/dirb/common.txt

2. Vulnerability scanning:
   nikto -h http://${target}

## Phase 3: Specific Testing
1. SQL injection testing:
   sqlmap -u "http://${target}/page?param=value" --dbs

2. WordPress testing (if applicable):
   wpscan --url http://${target}

## Phase 4: Documentation
- Document all findings
- Create proof of concept
- Follow responsible disclosure

⚠️ IMPORTANT: Only test targets within the defined scope and with proper authorization.
`;
  }

  // Get installation status summary
  getInstallationStatus() {
    const status = {};
    
    Object.entries(this.toolCategories).forEach(([category, data]) => {
      status[category] = {
        name: data.name,
        total: data.tools.length,
        installed: data.tools.filter(tool => this.isToolInstalled(tool.name)).length,
        tools: data.tools.map(tool => ({
          name: tool.name,
          installed: this.isToolInstalled(tool.name),
          description: tool.description
        }))
      };
    });

    return status;
  }
}
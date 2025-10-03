import { SECURITY_TOOLS, SUPPORTED_LANGUAGES, terminalIconSvg, executeIconSvg } from "./constants";

export class TerminalManager {
  constructor() {
    this.isTermuxAvailable = this.checkTermuxAvailability();
    this.commandHistory = [];
    this.currentDirectory = '/data/data/com.termux/files/home';
  }

  checkTermuxAvailability() {
    // Check if we're running in Termux environment
    try {
      return typeof window !== 'undefined' && 
             window.location.protocol === 'file:' &&
             navigator.userAgent.includes('Android');
    } catch (e) {
      return false;
    }
  }

  async executeCommand(command, language = 'bash') {
    if (!this.isTermuxAvailable) {
      throw new Error('Termux environment not available');
    }

    try {
      // Sanitize command for security
      const sanitizedCommand = this.sanitizeCommand(command, language);
      
      // Execute command using Termux API or shell
      const result = await this.runInTermux(sanitizedCommand, language);
      
      // Store in history
      this.commandHistory.push({
        command: sanitizedCommand,
        language,
        result,
        timestamp: new Date().toISOString()
      });

      return result;
    } catch (error) {
      console.error('Command execution failed:', error);
      throw error;
    }
  }

  sanitizeCommand(command, language) {
    // Remove potentially dangerous commands
    const dangerousPatterns = [
      /rm\s+-rf\s+\//, // Prevent root deletion
      /sudo\s+rm/, // Prevent sudo deletions
      /mkfs/, // Prevent filesystem formatting
      /dd\s+if=.*of=\/dev/, // Prevent disk writing
      /chmod\s+777\s+\//, // Prevent dangerous permissions
      /chown\s+.*:.*\s+\//, // Prevent ownership changes
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        throw new Error('Command contains potentially dangerous operations');
      }
    }

    return command.trim();
  }

  async runInTermux(command, language) {
    // Simulate terminal execution - in real implementation this would use Termux API
    return new Promise((resolve, reject) => {
      try {
        // For demonstration, we'll simulate different language executions
        let fullCommand;
        
        switch (language.toLowerCase()) {
          case 'python':
          case 'python3':
            fullCommand = `python3 -c "${command.replace(/"/g, '\\"')}"`;
            break;
          case 'javascript':
          case 'node':
            fullCommand = `node -e "${command.replace(/"/g, '\\"')}"`;
            break;
          case 'bash':
          case 'shell':
            fullCommand = command;
            break;
          case 'php':
            fullCommand = `php -r "${command.replace(/"/g, '\\"')}"`;
            break;
          case 'ruby':
            fullCommand = `ruby -e "${command.replace(/"/g, '\\"')}"`;
            break;
          case 'perl':
            fullCommand = `perl -e "${command.replace(/"/g, '\\"')}"`;
            break;
          case 'go':
            // For Go, we'd need to create a temporary file
            fullCommand = `echo '${command}' > /tmp/temp.go && go run /tmp/temp.go`;
            break;
          default:
            fullCommand = command;
        }

        // In a real implementation, this would execute the command
        // For now, we'll return a simulated response
        setTimeout(() => {
          resolve({
            stdout: `Executed: ${fullCommand}\n[Simulated output - integrate with actual Termux API]`,
            stderr: '',
            exitCode: 0,
            command: fullCommand
          });
        }, 100);

      } catch (error) {
        reject(error);
      }
    });
  }

  async installSecurityTool(toolName) {
    if (!SECURITY_TOOLS.includes(toolName)) {
      throw new Error(`Unknown security tool: ${toolName}`);
    }

    const installCommands = {
      'nmap': 'pkg install nmap',
      'nikto': 'pkg install nikto',
      'sqlmap': 'pip install sqlmap',
      'gobuster': 'pkg install gobuster',
      'ffuf': 'pkg install ffuf',
      'nuclei': 'pkg install nuclei',
      'subfinder': 'pkg install subfinder',
      'httpx': 'pkg install httpx',
      'waybackurls': 'go install github.com/tomnomnom/waybackurls@latest',
      'gau': 'go install github.com/lc/gau/v2/cmd/gau@latest',
      'amass': 'pkg install amass',
      'masscan': 'pkg install masscan',
      'john': 'pkg install john',
      'hashcat': 'pkg install hashcat',
      'hydra': 'pkg install hydra',
      'dirb': 'pkg install dirb',
      'wpscan': 'gem install wpscan',
      'recon-ng': 'pip install recon-ng',
      'theHarvester': 'pip install theHarvester',
      'dnsrecon': 'pip install dnsrecon',
      'fierce': 'pip install fierce'
    };

    const installCommand = installCommands[toolName];
    if (!installCommand) {
      throw new Error(`Installation command not found for ${toolName}`);
    }

    return await this.executeCommand(installCommand);
  }

  async runSecurityScan(toolName, target, options = {}) {
    if (!SECURITY_TOOLS.includes(toolName)) {
      throw new Error(`Unknown security tool: ${toolName}`);
    }

    // Validate target (basic URL/IP validation)
    if (!this.isValidTarget(target)) {
      throw new Error('Invalid target format');
    }

    const scanCommands = {
      'nmap': `nmap ${options.flags || '-sV'} ${target}`,
      'nikto': `nikto -h ${target}`,
      'sqlmap': `sqlmap -u "${target}" ${options.flags || '--batch'}`,
      'gobuster': `gobuster dir -u ${target} -w ${options.wordlist || '/usr/share/wordlists/common.txt'}`,
      'ffuf': `ffuf -u ${target}/FUZZ -w ${options.wordlist || '/usr/share/wordlists/common.txt'}`,
      'nuclei': `nuclei -u ${target} ${options.flags || ''}`,
      'subfinder': `subfinder -d ${target}`,
      'httpx': `echo ${target} | httpx`,
      'waybackurls': `echo ${target} | waybackurls`,
      'amass': `amass enum -d ${target}`,
      'masscan': `masscan ${target} ${options.flags || '-p1-65535 --rate=1000'}`,
      'hydra': `hydra ${options.flags || ''} ${target}`,
      'dirb': `dirb ${target} ${options.wordlist || '/usr/share/wordlists/common.txt'}`,
      'wpscan': `wpscan --url ${target} ${options.flags || ''}`,
      'theHarvester': `theHarvester -d ${target} -b google`,
      'dnsrecon': `dnsrecon -d ${target}`,
      'fierce': `fierce --domain ${target}`
    };

    const scanCommand = scanCommands[toolName];
    if (!scanCommand) {
      throw new Error(`Scan command not found for ${toolName}`);
    }

    return await this.executeCommand(scanCommand);
  }

  isValidTarget(target) {
    // Basic validation for URLs and IP addresses
    const urlPattern = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
    const ipPattern = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const domainPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;
    
    return urlPattern.test(target) || ipPattern.test(target) || domainPattern.test(target);
  }

  getCommandHistory() {
    return this.commandHistory;
  }

  clearHistory() {
    this.commandHistory = [];
  }

  async generateBugBountyReport(scanResults) {
    const report = {
      timestamp: new Date().toISOString(),
      target: scanResults.target,
      tools_used: scanResults.tools || [],
      findings: scanResults.findings || [],
      severity: this.calculateSeverity(scanResults.findings),
      recommendations: this.generateRecommendations(scanResults.findings)
    };

    return report;
  }

  calculateSeverity(findings) {
    if (!findings || findings.length === 0) return 'Info';
    
    const severityLevels = findings.map(finding => finding.severity || 'Low');
    
    if (severityLevels.includes('Critical')) return 'Critical';
    if (severityLevels.includes('High')) return 'High';
    if (severityLevels.includes('Medium')) return 'Medium';
    return 'Low';
  }

  generateRecommendations(findings) {
    const recommendations = [];
    
    findings.forEach(finding => {
      switch (finding.type) {
        case 'open_port':
          recommendations.push('Consider closing unnecessary open ports');
          break;
        case 'sql_injection':
          recommendations.push('Implement proper input validation and parameterized queries');
          break;
        case 'xss':
          recommendations.push('Implement proper output encoding and CSP headers');
          break;
        case 'directory_traversal':
          recommendations.push('Implement proper path validation and access controls');
          break;
        default:
          recommendations.push('Review and remediate the identified vulnerability');
      }
    });

    return [...new Set(recommendations)]; // Remove duplicates
  }
}
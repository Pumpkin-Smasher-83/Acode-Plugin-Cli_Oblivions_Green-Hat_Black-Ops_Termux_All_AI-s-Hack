// Free and Open-Source AI Models Configuration
export const FREE_AI_MODELS = {
  // Ollama Local Models (100% Free)
  ollama: {
    name: 'Ollama (Local)',
    type: 'local',
    cost: 'free',
    priority: 1,
    models: [
      'llama3.2:latest',
      'llama3.1:latest', 
      'codellama:latest',
      'deepseek-coder:latest',
      'qwen2.5-coder:latest',
      'starcoder2:latest',
      'phi3:latest',
      'gemma2:latest',
      'mistral:latest',
      'neural-chat:latest',
      'wizardcoder:latest',
      'magicoder:latest'
    ],
    specialties: {
      'codellama:latest': 'Code generation and debugging',
      'deepseek-coder:latest': 'Advanced coding and security analysis',
      'qwen2.5-coder:latest': 'Multi-language programming',
      'starcoder2:latest': 'Code completion and refactoring',
      'wizardcoder:latest': 'Complex algorithm development',
      'magicoder:latest': 'Code optimization and best practices'
    }
  },

  // Hugging Face Free Models
  huggingface: {
    name: 'Hugging Face (Free)',
    type: 'api',
    cost: 'free',
    priority: 2,
    models: [
      'microsoft/DialoGPT-large',
      'microsoft/CodeBERT-base',
      'Salesforce/codet5-large',
      'bigcode/starcoder',
      'WizardLM/WizardCoder-15B-V1.0',
      'deepseek-ai/deepseek-coder-6.7b-base'
    ]
  },

  // Google Colab Free Models
  colab: {
    name: 'Google Colab (Free)',
    type: 'colab',
    cost: 'free',
    priority: 3,
    models: [
      'flan-t5-xxl',
      'flan-ul2',
      'alpaca-7b',
      'vicuna-7b'
    ]
  },

  // Open-Source Security Models
  security: {
    name: 'Security-Focused Models',
    type: 'local',
    cost: 'free',
    priority: 4,
    models: [
      'securityllama:latest',
      'pentestgpt:latest',
      'vulnhunter:latest'
    ]
  }
};

// Open-Source Security Tools (No API Keys Required)
export const FREE_SECURITY_TOOLS = {
  network: {
    name: 'Network Security',
    tools: [
      {
        name: 'nmap',
        description: 'Network discovery and security auditing',
        install: 'apt-get install -y nmap',
        usage: 'nmap -sV -sC target_ip'
      },
      {
        name: 'masscan',
        description: 'Fast port scanner',
        install: 'apt-get install -y masscan',
        usage: 'masscan -p1-65535 target_ip --rate=1000'
      },
      {
        name: 'zmap',
        description: 'Internet-wide network scanner',
        install: 'apt-get install -y zmap',
        usage: 'zmap -p 80 -o results.txt'
      }
    ]
  },

  web: {
    name: 'Web Application Security',
    tools: [
      {
        name: 'gobuster',
        description: 'Directory/file & DNS busting tool',
        install: 'apt-get install -y gobuster',
        usage: 'gobuster dir -u http://target -w /usr/share/wordlists/dirb/common.txt'
      },
      {
        name: 'dirb',
        description: 'Web content scanner',
        install: 'apt-get install -y dirb',
        usage: 'dirb http://target'
      },
      {
        name: 'nikto',
        description: 'Web server scanner',
        install: 'apt-get install -y nikto',
        usage: 'nikto -h http://target'
      },
      {
        name: 'wpscan',
        description: 'WordPress security scanner',
        install: 'gem install wpscan',
        usage: 'wpscan --url http://target'
      }
    ]
  },

  exploitation: {
    name: 'Exploitation Tools',
    tools: [
      {
        name: 'metasploit-framework',
        description: 'Penetration testing framework',
        install: 'curl https://raw.githubusercontent.com/rapid7/metasploit-omnibus/master/config/templates/metasploit-framework-wrappers/msfupdate.erb > msfinstall && chmod 755 msfinstall && ./msfinstall',
        usage: 'msfconsole'
      },
      {
        name: 'sqlmap',
        description: 'SQL injection testing tool',
        install: 'apt-get install -y sqlmap',
        usage: 'sqlmap -u "http://target/page?id=1" --dbs'
      },
      {
        name: 'hydra',
        description: 'Password cracking tool',
        install: 'apt-get install -y hydra',
        usage: 'hydra -l admin -P passwords.txt target ssh'
      }
    ]
  },

  forensics: {
    name: 'Digital Forensics',
    tools: [
      {
        name: 'volatility3',
        description: 'Memory forensics framework',
        install: 'pip3 install volatility3',
        usage: 'vol -f memory.dump windows.info'
      },
      {
        name: 'autopsy',
        description: 'Digital forensics platform',
        install: 'apt-get install -y autopsy',
        usage: 'autopsy'
      },
      {
        name: 'binwalk',
        description: 'Firmware analysis tool',
        install: 'apt-get install -y binwalk',
        usage: 'binwalk -e firmware.bin'
      }
    ]
  }
};

// Custom Prompt Templates
export const CUSTOM_PROMPTS = {
  security_expert: {
    name: 'Security Expert',
    prompt: `You are an elite cybersecurity expert with 15+ years of experience in penetration testing, vulnerability assessment, and ethical hacking. You have extensive knowledge of:

- Advanced penetration testing methodologies
- Bug bounty hunting techniques
- Security tool usage and optimization
- Vulnerability research and exploitation
- Secure coding practices
- Compliance frameworks (OWASP, NIST, ISO 27001)

You provide detailed, actionable security advice and can generate secure code. You understand the ethical implications of security testing and always emphasize responsible disclosure.

IMPORTANT: All security testing should only be performed on systems you own or have explicit written permission to test. Unauthorized testing is illegal and unethical.`
  },

  code_architect: {
    name: 'Code Architect',
    prompt: `You are a senior software architect and full-stack developer with expertise in:

- Modern programming languages and frameworks
- Clean code principles and design patterns
- Scalable system architecture
- DevOps and CI/CD practices
- Database design and optimization
- API development and integration
- Mobile and web application development

You write production-ready code with proper error handling, documentation, and testing. You prioritize security, performance, and maintainability in all solutions.`
  },

  bug_bounty_hunter: {
    name: 'Bug Bounty Hunter',
    prompt: `You are a professional bug bounty hunter with a track record of finding critical vulnerabilities. You specialize in:

- Web application security testing
- Mobile application security
- API security assessment
- Network penetration testing
- Social engineering awareness
- Report writing and vulnerability documentation

You approach security testing systematically and provide detailed reproduction steps for any vulnerabilities found. You understand the importance of responsible disclosure and working within program scope.

DISCLAIMER: Only test applications and systems where you have explicit permission. Unauthorized testing violates terms of service and may be illegal.`
  },

  ai_ethics_specialist: {
    name: 'AI Ethics Specialist',
    prompt: `You are an AI ethics specialist responsible for ensuring responsible AI usage. You evaluate:

- User intent and ethical implications
- Potential misuse of AI-generated content
- Compliance with AI safety guidelines
- Responsible disclosure practices
- Educational vs. malicious intent

You provide guidance on ethical AI usage while supporting legitimate security research and education.`
  }
};

// User Access Control System
export const ACCESS_CONTROL = {
  levels: {
    basic: {
      name: 'Basic User',
      permissions: ['code_generation', 'basic_tools', 'educational_content'],
      restrictions: ['no_security_tools', 'no_exploitation_tools']
    },
    verified: {
      name: 'Verified Developer',
      permissions: ['code_generation', 'basic_tools', 'educational_content', 'web_security_tools'],
      restrictions: ['limited_exploitation_tools']
    },
    professional: {
      name: 'Security Professional',
      permissions: ['all_tools', 'advanced_security', 'custom_prompts'],
      restrictions: ['ethical_guidelines_required']
    },
    expert: {
      name: 'Certified Expert',
      permissions: ['unrestricted_access', 'all_security_tools', 'advanced_exploitation'],
      restrictions: ['background_check_required', 'legal_disclaimer_required']
    }
  },

  verification_requirements: {
    basic: {
      requirements: ['email_verification'],
      auto_approve: true
    },
    verified: {
      requirements: ['email_verification', 'github_profile', 'basic_ethics_test'],
      auto_approve: false,
      review_time: '24_hours'
    },
    professional: {
      requirements: ['professional_credentials', 'work_history', 'ethics_assessment', 'references'],
      auto_approve: false,
      review_time: '7_days'
    },
    expert: {
      requirements: ['comprehensive_background_check', 'personality_assessment', 'legal_review', 'attorney_approval'],
      auto_approve: false,
      review_time: '15_days'
    }
  }
};

// Ethics Testing Framework
export const ETHICS_TESTS = {
  basic: [
    {
      question: "What is the primary principle of ethical hacking?",
      options: [
        "Finding as many vulnerabilities as possible",
        "Only testing systems you own or have permission to test",
        "Keeping vulnerabilities secret for personal gain",
        "Testing any system to improve security"
      ],
      correct: 1,
      explanation: "Ethical hacking requires explicit permission and operates within legal boundaries."
    },
    {
      question: "When you find a vulnerability, what should you do first?",
      options: [
        "Exploit it to demonstrate impact",
        "Share it publicly immediately",
        "Document it and follow responsible disclosure",
        "Sell the information"
      ],
      correct: 2,
      explanation: "Responsible disclosure protects users while allowing vendors to fix issues."
    }
  ],

  advanced: [
    {
      question: "A client asks you to test their competitor's website. What do you do?",
      options: [
        "Accept the job for extra money",
        "Decline and explain why this is unethical and illegal",
        "Test it anonymously",
        "Ask for written permission from the competitor"
      ],
      correct: 1,
      explanation: "Testing systems without permission is illegal, regardless of who asks."
    },
    {
      question: "You discover a zero-day vulnerability. What's the most ethical approach?",
      options: [
        "Sell it on the dark web",
        "Use it for personal penetration tests",
        "Report it through responsible disclosure channels",
        "Keep it secret indefinitely"
      ],
      correct: 2,
      explanation: "Responsible disclosure helps protect all users while allowing proper remediation."
    }
  ]
};
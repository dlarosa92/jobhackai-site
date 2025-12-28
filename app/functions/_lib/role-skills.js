// Role-based skill templates for ATS keyword relevance scoring
// Each template defines must_have, nice_to_have, and tools for a role family

export const ROLE_SKILL_TEMPLATES = {
  software_engineer: {
    must_have: [
      "object-oriented programming",
      "software design patterns",
      "RESTful APIs",
      "version control",
      "unit testing",
      "debugging",
      "code reviews",
      "continuous integration",
      "agile development"
    ],
    nice_to_have: [
      "microservices",
      "clean architecture",
      "domain-driven design",
      "performance optimization",
      "security best practices"
    ],
    tools: [
      "Git",
      "GitHub",
      "GitLab",
      "VS Code",
      "IntelliJ IDEA",
      "Jira"
    ]
  },

  full_stack_developer: {
    must_have: [
      "JavaScript",
      "TypeScript",
      "HTML",
      "CSS",
      "front-end framework",
      "RESTful APIs",
      "server-side development",
      "SQL",
      "responsive design"
    ],
    nice_to_have: [
      "Next.js",
      "NoSQL",
      "GraphQL",
      "Docker",
      "automated testing"
    ],
    tools: [
      "React",
      "Node.js",
      "PostgreSQL",
      "MySQL",
      "MongoDB",
      "Docker"
    ]
  },

  front_end_engineer: {
    must_have: [
      "JavaScript",
      "TypeScript",
      "HTML",
      "CSS",
      "responsive web design",
      "web accessibility",
      "front-end performance"
    ],
    nice_to_have: [
      "design systems",
      "Storybook",
      "unit testing",
      "Figma collaboration"
    ],
    tools: [
      "React",
      "Vue",
      "Angular",
      "Tailwind CSS",
      "Figma",
      "Chrome DevTools"
    ]
  },

  back_end_engineer: {
    must_have: [
      "server-side programming",
      "RESTful API design",
      "authentication and authorization",
      "SQL and schema design",
      "logging and error handling"
    ],
    nice_to_have: [
      "message queues",
      "microservices",
      "caching",
      "security best practices"
    ],
    tools: [
      "PostgreSQL",
      "MySQL",
      "Redis",
      "Kafka",
      "Docker"
    ]
  },

  platform_engineer: {
    must_have: [
      "infrastructure as code",
      "CI/CD pipelines",
      "Kubernetes or container orchestration",
      "observability",
      "automation scripting"
    ],
    nice_to_have: [
      "multi-tenant platforms",
      "SLOs and SLIs",
      "internal developer platforms"
    ],
    tools: [
      "Kubernetes",
      "Helm",
      "Terraform",
      "Argo CD",
      "GitHub Actions",
      "Jenkins"
    ]
  },

  sre_engineer: {
    must_have: [
      "incident management",
      "on-call support",
      "monitoring and alerting",
      "service level objectives",
      "capacity planning"
    ],
    nice_to_have: [
      "chaos engineering",
      "disaster recovery",
      "error budgets"
    ],
    tools: [
      "Prometheus",
      "Grafana",
      "Datadog",
      "New Relic",
      "PagerDuty"
    ]
  },

  devops_engineer: {
    must_have: [
      "CI/CD pipelines",
      "infrastructure as code",
      "Linux administration",
      "shell scripting",
      "containerization",
      "cloud infrastructure"
    ],
    nice_to_have: [
      "configuration management",
      "GitOps",
      "artifact management"
    ],
    tools: [
      "Jenkins",
      "GitHub Actions",
      "GitLab CI",
      "Terraform",
      "Ansible",
      "Docker",
      "Kubernetes"
    ]
  },

  cloud_engineer: {
    must_have: [
      "cloud core services",
      "networking in cloud",
      "IAM and access control",
      "cloud databases",
      "high availability"
    ],
    nice_to_have: [
      "cost optimization",
      "cloud security",
      "multi-cloud or hybrid"
    ],
    tools: [
      "AWS",
      "Azure",
      "GCP",
      "CloudFormation",
      "Terraform",
      "CloudWatch",
      "Azure Monitor"
    ]
  },

  mobile_developer: {
    must_have: [
      "swift",
      "swiftui",
      "xcode",
      "ios",
      "objective-c",
      "uikit",
      "cocoa"
    ],
    nice_to_have: [
      "combine",
      "mvvm",
      "core data",
      "rest api",
      "firebase",
      "revenuecat"
    ],
    tools: ["Xcode", "Git", "CocoaPods", "Fastlane"]
  },

  data_engineer: {
    must_have: [
      "ETL / ELT pipelines",
      "SQL",
      "data modeling",
      "data warehousing",
      "batch and streaming data"
    ],
    nice_to_have: [
      "Spark",
      "Hadoop",
      "orchestration tools",
      "cloud data warehouses"
    ],
    tools: [
      "Python",
      "SQL",
      "Apache Spark",
      "Apache Airflow",
      "dbt",
      "Snowflake",
      "BigQuery",
      "Redshift"
    ]
  },

  data_scientist: {
    must_have: [
      "statistics",
      "machine learning",
      "feature engineering",
      "data visualization",
      "experiment design"
    ],
    nice_to_have: [
      "NLP",
      "time series",
      "recommendation systems"
    ],
    tools: [
      "Python",
      "Pandas",
      "NumPy",
      "Scikit-learn",
      "Jupyter",
      "Matplotlib"
    ]
  },

  ml_engineer: {
    must_have: [
      "machine learning algorithms",
      "model training and evaluation",
      "feature engineering",
      "ML deployment",
      "GPU or accelerator usage"
    ],
    nice_to_have: [
      "deep learning",
      "MLOps practices",
      "model monitoring"
    ],
    tools: [
      "TensorFlow",
      "PyTorch",
      "Scikit-learn",
      "MLflow",
      "Kubeflow",
      "Docker"
    ]
  },

  llm_engineer: {
    must_have: [
      "prompt engineering",
      "LLM fine-tuning or adaptation",
      "retrieval-augmented generation",
      "embeddings and vector search",
      "LLM evaluation"
    ],
    nice_to_have: [
      "guardrails and safety",
      "cost and latency optimization",
      "multi-provider LLM orchestration"
    ],
    tools: [
      "OpenAI API",
      "Anthropic Claude",
      "Hugging Face",
      "LangChain",
      "Pinecone",
      "Weaviate",
      "FAISS"
    ]
  },

  ai_engineer: {
    must_have: [
      "AI/ML fundamentals",
      "using AI APIs",
      "data preprocessing",
      "model integration into apps",
      "evaluation of AI features"
    ],
    nice_to_have: [
      "A/B testing for AI",
      "AI safety and fairness",
      "explainability basics"
    ],
    tools: [
      "Python",
      "OpenAI API",
      "TensorFlow or PyTorch",
      "REST APIs",
      "Docker"
    ]
  },

  product_manager: {
    must_have: [
      "product discovery",
      "requirements gathering",
      "backlog prioritization",
      "roadmap planning",
      "stakeholder management",
      "data-driven decision making"
    ],
    nice_to_have: [
      "A/B testing",
      "product analytics",
      "go-to-market strategy"
    ],
    tools: [
      "Jira",
      "Confluence",
      "Productboard",
      "Figma",
      "analytics tools"
    ]
  },

  product_owner: {
    must_have: [
      "backlog",
      "user stories",
      "roadmap",
      "stakeholders",
      "prioritization",
      "sprint",
      "Scrum",
      "acceptance criteria",
      "requirements",
      "Agile",
      "cross-functional",
      "KPIs",
      "delivery",
      "product backlog management",
      "sprint planning and refinement",
      "working with development teams"
    ],
    nice_to_have: [
      "SAFe or scaled agile frameworks",
      "story mapping",
      "experience with release trains",
      "value stream thinking"
    ],
    tools: [
      "Jira",
      "Azure DevOps",
      "Confluence",
      "Miro"
    ]
  },

  scrum_master: {
    must_have: [
      "Scrum ceremonies",
      "impediment removal",
      "team coaching",
      "continuous improvement",
      "Kanban basics"
    ],
    nice_to_have: [
      "SAFe or other scaling frameworks",
      "agile metrics",
      "conflict resolution"
    ],
    tools: [
      "Jira",
      "Azure DevOps",
      "Miro",
      "Confluence"
    ]
  },

  agile_coach: {
    must_have: [
      "enterprise agile transformation",
      "coaching multiple teams",
      "Scrum and Kanban",
      "change management"
    ],
    nice_to_have: [
      "OKRs",
      "value stream mapping",
      "leadership coaching"
    ],
    tools: [
      "Jira",
      "Miro",
      "Confluence"
    ]
  },

  solution_architect: {
    must_have: [
      "solution design",
      "system integration patterns",
      "API design",
      "non-functional requirements",
      "architecture documentation"
    ],
    nice_to_have: [
      "cloud reference architectures",
      "security and compliance",
      "cost modeling"
    ],
    tools: [
      "diagramming tools",
      "cloud provider consoles"
    ]
  },

  system_architect: {
    must_have: [
      "system-level design",
      "scalability and reliability",
      "performance optimization",
      "platform and infrastructure knowledge"
    ],
    nice_to_have: [
      "distributed systems",
      "event-driven architecture",
      "consistency models"
    ],
    tools: [
      "architecture modeling tools",
      "monitoring dashboards"
    ]
  },

  data_architect: {
    must_have: [
      "enterprise data modeling",
      "data warehousing",
      "data integration patterns",
      "metadata management"
    ],
    nice_to_have: [
      "data governance",
      "MDM solutions",
      "data catalog tools"
    ],
    tools: [
      "ER modeling tools",
      "dbt",
      "Snowflake",
      "BigQuery"
    ]
  },

  security_engineer: {
    must_have: [
      "security best practices",
      "vulnerability management",
      "secure coding",
      "IAM",
      "threat modeling"
    ],
    nice_to_have: [
      "cloud security",
      "network security",
      "SIEM usage"
    ],
    tools: [
      "vulnerability scanners",
      "SIEM platforms",
      "WAFs",
      "EDR tools"
    ]
  },

  threat_analyst: {
    must_have: [
      "threat intelligence",
      "incident triage",
      "log investigation",
      "attacker TTPs",
      "MITRE ATT&CK awareness"
    ],
    nice_to_have: [
      "threat hunting",
      "malware basics",
      "intel feeds"
    ],
    tools: [
      "SIEM platforms",
      "EDR tools",
      "threat intel platforms"
    ]
  },

  qa_engineer: {
    must_have: [
      "test case design",
      "regression testing",
      "functional testing",
      "defect reporting",
      "basic SQL validation"
    ],
    nice_to_have: [
      "exploratory testing",
      "API testing",
      "test planning"
    ],
    tools: [
      "Jira",
      "TestRail",
      "Postman",
      "Selenium",
      "Cypress"
    ]
  },

  test_automation_engineer: {
    must_have: [
      "test automation frameworks",
      "UI automation",
      "API automation",
      "CI/CD integration"
    ],
    nice_to_have: [
      "performance testing basics",
      "contract testing",
      "test containers"
    ],
    tools: [
      "Selenium",
      "Cypress",
      "Playwright",
      "JUnit / NUnit / TestNG",
      "Postman"
    ]
  },

  ux_designer: {
    must_have: [
      "wireframing and prototyping",
      "interaction design",
      "information architecture",
      "design systems",
      "user-centered design"
    ],
    nice_to_have: [
      "usability testing",
      "accessibility standards",
      "basic front-end awareness"
    ],
    tools: [
      "Figma",
      "Sketch",
      "Adobe XD",
      "Miro"
    ]
  },

  ux_researcher: {
    must_have: [
      "research planning",
      "user interviews",
      "usability testing",
      "survey design",
      "insight synthesis"
    ],
    nice_to_have: [
      "mixed methods",
      "diary studies",
      "UX metrics"
    ],
    tools: [
      "research platforms",
      "Figma",
      "Miro",
      "Dovetail"
    ]
  },

  business_analyst: {
    must_have: [
      "requirements elicitation",
      "process mapping",
      "stakeholder interviews",
      "user story writing",
      "gap analysis"
    ],
    nice_to_have: [
      "data analysis",
      "UML or BPMN",
      "test support"
    ],
    tools: [
      "Jira",
      "Confluence",
      "Visio",
      "Miro",
      "Excel"
    ]
  },

  generic_engineer: {
    must_have: [
      "problem solving",
      "technical communication",
      "requirements understanding",
      "collaboration"
    ],
    nice_to_have: [
      "mentoring",
      "documentation",
      "agile practices"
    ],
    tools: [
      "Git",
      "issue tracking tools"
    ]
  },

  generic_architect: {
    must_have: [
      "system design",
      "documentation",
      "cross-team collaboration",
      "technical leadership"
    ],
    nice_to_have: [
      "governance",
      "cost and risk analysis"
    ],
    tools: [
      "diagramming tools",
      "architecture reviews"
    ]
  },

  generic_professional: {
    must_have: [
      "communication skills",
      "stakeholder management",
      "time management",
      "basic data literacy"
    ],
    nice_to_have: [
      "continuous improvement",
      "cross-functional collaboration"
    ],
    tools: [
      "office productivity tools",
      "project tracking tools"
    ]
  }
};


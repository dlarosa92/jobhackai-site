// Normalize a specific job title label into a canonical "family" key

export function normalizeRoleToFamily(roleLabel) {
  if (!roleLabel) return "generic_professional";

  const base = roleLabel.toLowerCase();
  const cleaned = base
    .replace(/\b(senior|sr\.?|staff|principal|lead|junior|jr\.?)\b/g, "")
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Product Owner-specific normalization (must come before product_manager)
  if (cleaned.includes("product owner") || cleaned.includes("productowner")) {
    return "product_owner";
  }
  if (cleaned.includes("epic owner") || cleaned.includes("epicowner")) {
    return "product_owner";
  }
  if (cleaned.includes("feature owner") || cleaned.includes("featureowner")) {
    return "product_owner";
  }
  // Handle "PO" abbreviation
  if (cleaned === "po" || cleaned === "p.o.") {
    return "product_owner";
  }

  // Full stack (check both "full stack" and "fullstack" since normalizeJobTitle removes hyphens)
  if (cleaned.includes("full stack") || cleaned.includes("fullstack")) {
    return "full_stack_developer";
  }

  // Front end
  if (cleaned.includes("front end") || cleaned.includes("frontend")) {
    return "front_end_engineer";
  }

  // Back end
  if (cleaned.includes("back end") || cleaned.includes("backend")) {
    return "back_end_engineer";
  }

  // SRE
  if (cleaned.includes("site reliability") || cleaned.includes("sre")) {
    return "sre_engineer";
  }

  // DevOps
  if (cleaned.includes("devops")) {
    return "devops_engineer";
  }

  // Platform
  if (cleaned.includes("platform engineer")) {
    return "platform_engineer";
  }

  // Cloud
  if (cleaned.includes("cloud engineer")) {
    return "cloud_engineer";
  }

  // Data Engineer
  if (cleaned.includes("data engineer")) {
    return "data_engineer";
  }

  // Data Scientist
  if (cleaned.includes("data scientist")) {
    return "data_scientist";
  }

  // Machine Learning
  if (cleaned.includes("machine learning") || cleaned.includes("ml engineer")) {
    return "ml_engineer";
  }

  // LLM
  if (cleaned.includes("llm")) {
    return "llm_engineer";
  }

  // AI Engineer
  if (cleaned.includes("ai engineer")) {
    return "ai_engineer";
  }

  // Product Manager (after Product Owner check)
  if (cleaned.includes("product manager")) {
    return "product_manager";
  }

  // Scrum Master
  if (cleaned.includes("scrum master")) {
    return "scrum_master";
  }

  // Agile Coach
  if (cleaned.includes("agile coach")) {
    return "agile_coach";
  }

  // Solution Architect
  if (cleaned.includes("solution architect")) {
    return "solution_architect";
  }

  // System Architect
  if (cleaned.includes("system architect")) {
    return "system_architect";
  }

  // Data Architect
  if (cleaned.includes("data architect")) {
    return "data_architect";
  }

  // Security Engineer
  if (cleaned.includes("security engineer")) {
    return "security_engineer";
  }

  // Threat Analyst
  if (cleaned.includes("threat analyst")) {
    return "threat_analyst";
  }

  // QA Engineer
  if (cleaned.includes("qa engineer")) {
    return "qa_engineer";
  }

  // Test Automation
  if (cleaned.includes("test automation")) {
    return "test_automation_engineer";
  }

  // UX Researcher
  if (cleaned.includes("ux researcher")) {
    return "ux_researcher";
  }

  // UX Designer / Product Designer
  if (cleaned.includes("ux designer") || cleaned.includes("product designer")) {
    return "ux_designer";
  }

  // Business Analyst
  if (cleaned.includes("business analyst")) {
    return "business_analyst";
  }

  // Software Engineer (must come before generic engineer fallback)
  if (cleaned.includes("software engineer") || cleaned.includes("softwareengineer")) {
    return "software_engineer";
  }

  // Generic fallbacks
  if (cleaned.includes("engineer")) {
    return "generic_engineer";
  }

  if (cleaned.includes("architect")) {
    return "generic_architect";
  }

  return "generic_professional";
}


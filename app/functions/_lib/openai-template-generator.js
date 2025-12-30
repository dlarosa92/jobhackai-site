/**
 * OpenAI Role Template Generator
 * Generates role skill templates using OpenAI API
 */

import { normalizeRoleToFamily } from './role-normalizer.js';

/**
 * Generate a role template using OpenAI
 * @param {Object} env - Cloudflare environment
 * @param {string} roleLabel - User-entered role label (e.g., "iOS Engineer")
 * @returns {Promise<Object>} Template { role_family, must_have, nice_to_have, tools }
 */
export async function generateRoleTemplate(env, roleLabel) {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const roleFamily = normalizeRoleToFamily(roleLabel);
  
  const prompt = `Generate a role skill template for "${roleLabel}" (normalized to "${roleFamily}").

Return ONLY valid JSON with this exact structure:
{
  "must_have": ["skill1", "skill2", ...],
  "nice_to_have": ["skill3", "skill4", ...],
  "tools": ["tool1", "tool2", ...]
}

Guidelines:
- Focus on industry-standard skills and tools for this role as of 2025
- Keep arrays concise (5-10 items each)
- Use lowercase for skills (e.g., "swift", "ios", "rest api")
- Use proper case for tools (e.g., "Xcode", "Git", "Docker")
- Must-have skills are essential/core competencies
- Nice-to-have skills are valuable but not required
- Tools are commonly used software/platforms for this role
- Be specific and avoid generic terms`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Cost-effective model
        messages: [
          { role: 'system', content: 'You are an expert in job role requirements and skill templates. Return only valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = JSON.parse(data.choices[0].message.content);
    
    // Validate structure
    if (!Array.isArray(content.must_have) || !Array.isArray(content.nice_to_have) || !Array.isArray(content.tools)) {
      throw new Error('Invalid template structure from OpenAI');
    }
    
    return {
      role_family: roleFamily,
      must_have: content.must_have || [],
      nice_to_have: content.nice_to_have || [],
      tools: content.tools || []
    };
  } catch (error) {
    console.error('[TEMPLATE-GENERATOR] Error generating template:', error);
    throw error;
  }
}


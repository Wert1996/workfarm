import { v4 as uuidv4 } from 'uuid';
import { AgentPreference } from '../types';
import { RuntimeAdapter } from './RuntimeAdapter';
import { eventBus } from './EventBus';

export class PreferenceManager {
  private runtime: RuntimeAdapter;
  private preferences: Map<string, AgentPreference[]> = new Map(); // agentId -> preferences

  constructor(runtime: RuntimeAdapter) {
    this.runtime = runtime;
  }

  async loadForAgent(agentId: string): Promise<void> {
    const saved = await this.runtime.loadPreferences(agentId);
    this.preferences.set(agentId, saved);
  }

  private async saveForAgent(agentId: string): Promise<void> {
    const prefs = this.preferences.get(agentId) || [];
    await this.runtime.savePreferences(agentId, prefs);
  }

  getPreferences(agentId: string): AgentPreference[] {
    return this.preferences.get(agentId) || [];
  }

  addPreference(
    agentId: string,
    pref: { category: string; key: string; value: string; source: string; confidence: AgentPreference['confidence'] }
  ): AgentPreference {
    if (!this.preferences.has(agentId)) {
      this.preferences.set(agentId, []);
    }
    const prefs = this.preferences.get(agentId)!;

    // Replace existing preference with same key (upgrade confidence)
    const existingIdx = prefs.findIndex(p => p.key === pref.key);
    if (existingIdx >= 0) {
      const existing = prefs[existingIdx];
      // Only replace if new confidence is equal or higher
      const rank = { assumed: 0, inferred: 1, explicit: 2 };
      if (rank[pref.confidence] >= rank[existing.confidence]) {
        existing.value = pref.value;
        existing.source = pref.source;
        existing.confidence = pref.confidence;
        existing.category = pref.category;
        this.saveForAgent(agentId);
        return existing;
      }
      return existing;
    }

    const newPref: AgentPreference = {
      id: uuidv4(),
      agentId,
      ...pref,
      createdAt: Date.now(),
      usedCount: 0,
      lastUsedAt: null,
    };
    prefs.push(newPref);
    this.saveForAgent(agentId);

    eventBus.emit('preference_extracted', { agentId, preference: newPref });
    return newPref;
  }

  removePreference(agentId: string, key: string): boolean {
    const prefs = this.preferences.get(agentId);
    if (!prefs) return false;
    const idx = prefs.findIndex(p => p.key === key);
    if (idx < 0) return false;
    prefs.splice(idx, 1);
    this.saveForAgent(agentId);
    return true;
  }

  incrementUsage(agentId: string, key: string): void {
    const prefs = this.preferences.get(agentId);
    if (!prefs) return;
    const pref = prefs.find(p => p.key === key);
    if (pref) {
      pref.usedCount++;
      pref.lastUsedAt = Date.now();
      this.saveForAgent(agentId);
    }
  }

  buildPreferenceContext(agentId: string): string {
    const prefs = this.getPreferences(agentId);
    if (prefs.length === 0) return '';

    const lines = prefs.map(p => {
      const usage = p.usedCount > 0 ? `, used ${p.usedCount} time(s)` : '';
      return `- [${p.category}] ${p.key}: ${p.value} (${p.confidence}${usage})`;
    });

    return `Known user preferences:\n${lines.join('\n')}`;
  }

  /**
   * Parse preference extraction results from Claude's response.
   * Expected format: {"preferences": [{"category": "...", "key": "...", "value": "...", "confidence": "..."}]}
   */
  parseAndStoreExtraction(agentId: string, result: string, source: string): AgentPreference[] {
    const extracted: AgentPreference[] = [];
    try {
      const jsonMatch = result.match(/\{[\s\S]*"preferences"[\s\S]*\}/);
      if (!jsonMatch) return extracted;

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed.preferences)) return extracted;

      for (const p of parsed.preferences) {
        if (p.key && p.value && p.category) {
          const confidence = ['explicit', 'inferred', 'assumed'].includes(p.confidence)
            ? p.confidence as AgentPreference['confidence']
            : 'inferred';
          const pref = this.addPreference(agentId, {
            category: p.category,
            key: p.key,
            value: p.value,
            source,
            confidence,
          });
          extracted.push(pref);
        }
      }
    } catch {
      // Parsing failed — no preferences extracted
    }
    return extracted;
  }

  /**
   * Build the extraction prompt for Claude to analyze an interaction and find preferences.
   */
  buildExtractionPrompt(
    agentId: string,
    interaction: { userMessage: string; agentMessage: string; context: string }
  ): string {
    const existing = this.getPreferences(agentId);
    const existingStr = existing.length > 0
      ? `\nExisting preferences:\n${existing.map(p => `- ${p.key}: ${p.value} (${p.confidence})`).join('\n')}`
      : '\nNo existing preferences.';

    return [
      `Analyze this interaction and extract any user preferences.`,
      `\nContext: ${interaction.context}`,
      `Agent said: "${interaction.agentMessage.substring(0, 300)}"`,
      `User replied: "${interaction.userMessage.substring(0, 300)}"`,
      existingStr,
      `\nExtract new or updated preferences. Output ONLY valid JSON:`,
      `{"preferences": [{"category": "style|testing|workflow|architecture|tooling|other", "key": "short_key_name", "value": "the preference value", "confidence": "explicit|inferred"}]}`,
      `\nRules:`,
      `- Only extract clear, reusable preferences`,
      `- "explicit" = user directly stated it`,
      `- "inferred" = reasonable conclusion from what user said`,
      `- Don't duplicate existing preferences unless updating them`,
      `- If nothing to extract, output: {"preferences": []}`,
    ].join('\n');
  }
}

export { EventBus, eventBus } from './EventBus';
export { AgentManager } from './AgentManager';
export { TaskManager } from './TaskManager';
export { ClaudeCodeBridge } from './ClaudeCodeBridge';
export { SessionManager } from './SessionManager';
export { GoalManager } from './GoalManager';
export { AdversaryAgent } from './AdversaryAgent';
export { TriggerScheduler } from './TriggerScheduler';
export { PreferenceManager } from './PreferenceManager';
export type { RuntimeAdapter } from './RuntimeAdapter';
export type { ILLMClient, LLMRequest, LLMResponse } from './LLMClient';
export { ClaudeCLILLMClient } from './LLMClient';
export { ElectronAdapter } from './ElectronAdapter';
// NodeAdapter is not re-exported here — it uses Node.js built-ins (child_process, fs)
// which Vite externalizes in the browser renderer. Import it directly in Node.js contexts:
//   import { NodeAdapter } from './control/NodeAdapter';

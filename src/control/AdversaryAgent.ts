import { v4 as uuidv4 } from 'uuid';
import { AgentGoal, AgentPlan, PlanStep } from '../types';
import { ILLMClient } from './LLMClient';
import { GoalManager } from './GoalManager';
import { AgentManager } from './AgentManager';
import { TaskManager } from './TaskManager';
import { ClaudeCodeBridge } from './ClaudeCodeBridge';
import { PreferenceManager } from './PreferenceManager';
import { eventBus } from './EventBus';

const NEEDS_INPUT_MARKER = '[NEEDS_INPUT]:';
const USED_PREFERENCE_REGEX = /\[Used preference:\s*([^\]]+)\]/g;

export class AdversaryAgent {
  private llm: ILLMClient;
  private goalManager: GoalManager;
  private agentManager: AgentManager;
  private taskManager: TaskManager;
  private bridge: ClaudeCodeBridge;
  private preferenceManager: PreferenceManager | null = null;
  private activeGoals: Set<string> = new Set();
  private stepTaskMap: Map<string, { goalId: string; stepId: string }> = new Map();
  private reconTaskMap: Map<string, string> = new Map(); // taskId -> goalId
  private reconResults: Map<string, string> = new Map(); // goalId -> recon report
  private retryMap: Map<string, number> = new Map(); // stepId -> retryCount
  private eventCleanups: (() => void)[] = [];

  constructor(
    llm: ILLMClient,
    goalManager: GoalManager,
    agentManager: AgentManager,
    taskManager: TaskManager,
    bridge: ClaudeCodeBridge,
    preferenceManager?: PreferenceManager
  ) {
    this.llm = llm;
    this.goalManager = goalManager;
    this.agentManager = agentManager;
    this.taskManager = taskManager;
    this.bridge = bridge;
    this.preferenceManager = preferenceManager || null;
    this.setupListeners();
  }

  setPreferenceManager(pm: PreferenceManager): void {
    this.preferenceManager = pm;
  }

  private setupListeners(): void {
    const unsub = eventBus.on('session_ended', (event) => {
      const { taskId, status } = event.data;

      // Handle recon task completion
      const reconGoalId = this.reconTaskMap.get(taskId);
      if (reconGoalId) {
        this.reconTaskMap.delete(taskId);
        const task = this.taskManager.getTask(taskId);
        const result = task?.result || '';
        if (status === 'completed' && result) {
          this.reconResults.set(reconGoalId, result);
          console.log(`[Adversary] Recon complete, generating informed plan...`);
          this.generatePlan(reconGoalId);
        } else {
          console.log(`[Adversary] Recon failed, generating plan without context`);
          this.generatePlan(reconGoalId);
        }
        return;
      }

      // Handle step task completion
      const mapping = this.stepTaskMap.get(taskId);
      if (!mapping) return;

      const { goalId, stepId } = mapping;
      this.stepTaskMap.delete(taskId);

      const task = this.taskManager.getTask(taskId);
      const result = task?.result || (status === 'completed' ? 'Completed' : 'Failed');

      if (status === 'completed') {
        // Check for [NEEDS_INPUT] marker — try to answer before escalating
        const needsInput = this.extractNeedsInput(result);
        if (needsInput) {
          this.tryAnswerOrEscalate(goalId, stepId, needsInput, result);
          return;
        }

        // Track [Used preference: key] markers
        this.trackPreferenceUsage(goalId, result);

        // Evaluate the result via adversary LLM
        this.evaluateStepResult(goalId, stepId, result);
      } else {
        this.goalManager.updatePlanStep(goalId, stepId, {
          status: 'failed',
          result: `Error: ${result}`,
          completedAt: Date.now(),
        });
        this.evaluateAndContinue(goalId);
      }
    });
    this.eventCleanups.push(unsub);
  }

  destroy(): void {
    for (const cleanup of this.eventCleanups) {
      cleanup();
    }
    this.eventCleanups = [];
  }

  private extractNeedsInput(result: string): string | null {
    const idx = result.lastIndexOf(NEEDS_INPUT_MARKER);
    if (idx < 0) return null;
    return result.substring(idx + NEEDS_INPUT_MARKER.length).trim();
  }

  private trackPreferenceUsage(goalId: string, result: string): void {
    if (!this.preferenceManager) return;
    const goal = this.goalManager.getGoal(goalId);
    if (!goal) return;

    let match;
    USED_PREFERENCE_REGEX.lastIndex = 0;
    while ((match = USED_PREFERENCE_REGEX.exec(result)) !== null) {
      this.preferenceManager.incrementUsage(goal.agentId, match[1].trim());
    }
  }

  // ── Public API (same surface as PlannerLoop) ──

  async wake(goalId: string): Promise<void> {
    const goal = this.goalManager.getGoal(goalId);
    if (!goal) {
      console.log(`[Adversary] Goal ${goalId} not found`);
      return;
    }

    if (goal.status === 'paused') {
      this.goalManager.resumeGoal(goalId);
    }

    if (goal.status !== 'active') {
      console.log(`[Adversary] Goal ${goalId} is ${goal.status}, not active`);
      return;
    }

    if (this.activeGoals.has(goalId)) {
      console.log(`[Adversary] Goal ${goalId} is already executing`);
      return;
    }

    const agent = this.agentManager.getAgent(goal.agentId);
    if (!agent) {
      console.log(`[Adversary] Agent ${goal.agentId} not found`);
      return;
    }

    if (this.bridge.isExecuting(goal.agentId)) {
      console.log(`[Adversary] Agent ${agent.name} is busy`);
      return;
    }

    this.activeGoals.add(goalId);

    // Check for blocked step first (waiting for reply)
    const blockedStep = this.goalManager.getBlockedStep(goalId);
    if (blockedStep) {
      console.log(`[Adversary] Goal has blocked step waiting for reply`);
      this.activeGoals.delete(goalId);
      return;
    }

    const plan = this.goalManager.getCurrentPlan(goalId);
    const nextStep = plan ? this.goalManager.getNextPendingStep(goalId) : undefined;

    if (!plan || !nextStep) {
      await this.gatherContext(goalId);
      return;
    }

    await this.executeNextStep(goalId);
  }

  pause(goalId: string): void {
    const goal = this.goalManager.getGoal(goalId);
    if (goal) {
      this.goalManager.pauseGoal(goalId);
      this.activeGoals.delete(goalId);
    }
  }

  async reply(goalId: string, answer: string): Promise<void> {
    const goal = this.goalManager.getGoal(goalId);
    if (!goal) return;

    const blockedStep = this.goalManager.getBlockedStep(goalId);
    if (!blockedStep) {
      console.log(`[Adversary] No blocked step found for goal ${goalId}`);
      return;
    }

    const agent = this.agentManager.getAgent(goal.agentId);
    if (!agent) return;

    const plan = this.goalManager.getCurrentPlan(goalId);
    if (!plan) return;

    // Trigger preference extraction from this interaction
    if (this.preferenceManager && blockedStep.question) {
      this.triggerPreferenceExtraction(
        goal.agentId,
        blockedStep.question,
        answer,
        `Step ${blockedStep.order + 1}: ${blockedStep.description}`
      );
    }

    // Resume the step with the user's answer
    this.goalManager.updatePlanStep(goalId, blockedStep.id, {
      status: 'in_progress',
      question: null,
    });

    this.activeGoals.add(goalId);

    // Ask adversary LLM to craft a concrete instruction incorporating the user's answer
    const workerInstruction = await this.craftReplyInstruction(goal, plan, blockedStep, answer);

    const prompt = this.buildWorkerPrompt(agent, goal, workerInstruction, plan, blockedStep.id);

    const task = this.taskManager.createTask(`[Step ${blockedStep.order + 1} resumed] ${blockedStep.description}`);
    this.taskManager.assignAgent(task.id, agent.id);
    this.agentManager.assignTask(agent.id, task.id);

    this.goalManager.updatePlanStep(goalId, blockedStep.id, { taskId: task.id });
    this.stepTaskMap.set(task.id, { goalId, stepId: blockedStep.id });

    const result = await this.bridge.executeTask(agent.id, task.id, goal.maxTurnsPerStep, goal.workingDirectory, prompt);
    if (!result.success) {
      this.goalManager.updatePlanStep(goalId, blockedStep.id, {
        status: 'failed',
        result: `Failed to resume: ${result.error}`,
        completedAt: Date.now(),
      });
      this.stepTaskMap.delete(task.id);
      this.evaluateAndContinue(goalId);
    }
  }

  async talk(agentId: string, message: string, activitySummary?: string): Promise<string> {
    const agent = this.agentManager.getAgent(agentId);
    if (!agent) return 'Agent not found.';

    const goal = this.goalManager.getActiveGoal(agentId);

    // Build system prompt with context for the adversary
    const contextParts: string[] = [];
    contextParts.push(`You are responding on behalf of ${agent.name}, an autonomous agent.`);
    contextParts.push(`The user is asking about progress or status. Answer helpfully and concisely.`);

    if (goal) {
      contextParts.push(`\nCurrent goal: ${goal.description}`);
      const plan = this.goalManager.getCurrentPlan(goal.id);
      if (plan) {
        contextParts.push(`Plan (v${plan.version}):`);
        for (const step of plan.steps) {
          contextParts.push(`  [${step.status}] Step ${step.order + 1}: ${step.description}`);
          if (step.result) contextParts.push(`    Result: ${step.result.substring(0, 150)}`);
        }
      }
    }

    if (activitySummary && activitySummary !== 'No activity recorded.') {
      contextParts.push(`\nRecent activity:\n${activitySummary}`);
    }

    const response = await this.llm.complete({
      systemPrompt: contextParts.join('\n'),
      prompt: message,
    });

    if (response.error) {
      return `Error talking to ${agent.name}: ${response.error}`;
    }
    return response.content || 'No response.';
  }

  isGoalActive(goalId: string): boolean {
    return this.activeGoals.has(goalId);
  }

  // ── Private: Recon Phase ──

  private async gatherContext(goalId: string): Promise<void> {
    const goal = this.goalManager.getGoal(goalId);
    if (!goal) {
      this.activeGoals.delete(goalId);
      return;
    }

    const agent = this.agentManager.getAgent(goal.agentId);
    if (!agent) {
      this.activeGoals.delete(goalId);
      return;
    }

    const workDir = goal.workingDirectory || this.bridge.getWorkingDirectory();
    const roots = this.bridge.getWorkspaceRoots();

    console.log(`[Adversary] Scouting codebase before planning: ${goal.description}`);

    const reconInstruction = [
      `<instruction>`,
      `You are ${agent.name}, an autonomous agent doing reconnaissance for a goal.`,
      ``,
      `Goal: "${goal.description}"`,
      `Working directory: ${workDir}`,
      roots.length > 0 ? `Workspace roots: ${roots.join(', ')}` : '',
      ``,
      `Your job is to EXPLORE and REPORT. Do NOT make any changes.`,
      ``,
      `Investigate the codebase and produce a report covering:`,
      `1. Project location (exact path)`,
      `2. Language(s) and framework(s)`,
      `3. Directory structure (key directories and what they contain)`,
      `4. Dependencies (from package.json, requirements.txt, etc.)`,
      `5. Build/test setup (scripts, CI config)`,
      `6. Current state — what exists, what's missing, what's broken`,
      `7. Code quality observations — patterns, anti-patterns, test coverage`,
      `8. Specific opportunities for improvement relevant to the goal`,
      ``,
      `End your response with a structured summary:`,
      `<recon_summary>`,
      `PROJECT_PATH: /exact/path`,
      `LANGUAGE: ...`,
      `FRAMEWORK: ...`,
      `KEY_FILES: file1, file2, ...`,
      `CURRENT_STATE: brief description`,
      `IMPROVEMENT_OPPORTUNITIES: bullet list`,
      `</recon_summary>`,
      `</instruction>`,
    ].filter(l => l !== undefined).join('\n');

    const task = this.taskManager.createTask(`[Recon] ${goal.description}`);
    this.taskManager.assignAgent(task.id, agent.id);
    this.agentManager.assignTask(agent.id, task.id);
    this.reconTaskMap.set(task.id, goalId);

    const result = await this.bridge.executeTask(agent.id, task.id, goal.maxTurnsPerStep, goal.workingDirectory, reconInstruction);
    if (!result.success) {
      this.reconTaskMap.delete(task.id);
      console.log(`[Adversary] Recon failed to start: ${result.error}, planning without context`);
      await this.generatePlan(goalId);
    }
    // Otherwise, the session_ended listener will call generatePlan with the recon results
  }

  // ── Private: Plan Generation via LLM ──

  private async generatePlan(goalId: string): Promise<void> {
    const goal = this.goalManager.getGoal(goalId);
    if (!goal) {
      this.activeGoals.delete(goalId);
      return;
    }

    const agent = this.agentManager.getAgent(goal.agentId);
    if (!agent) {
      this.activeGoals.delete(goalId);
      return;
    }

    // Gather previous results if re-planning
    const existingPlan = this.goalManager.getCurrentPlan(goalId);
    let previousResultsStr = '';
    if (existingPlan) {
      const completed = existingPlan.steps.filter(s => s.status === 'completed' && s.result);
      if (completed.length > 0) {
        previousResultsStr = '\nPrevious step results:\n' +
          completed.map(s => `- ${s.description}: ${s.result!.substring(0, 500)}`).join('\n');
      }
    }

    // Use recon report if available
    const reconReport = this.reconResults.get(goalId);
    if (reconReport) {
      this.reconResults.delete(goalId); // consumed
    }

    const preferenceContext = this.getPreferenceContext(goal.agentId);
    const workDir = goal.workingDirectory || this.bridge.getWorkingDirectory();
    const roots = this.bridge.getWorkspaceRoots();

    const planPrompt = [
      `You are an orchestrator managing an autonomous agent.`,
      ``,
      `Goal: "${goal.description}"`,
      `Agent: ${agent.name}`,
      `Constraints: ${goal.constraints.length > 0 ? goal.constraints.join(', ') : 'none'}`,
      `Working directory: ${workDir}`,
      roots.length > 0 ? `Workspace roots: ${roots.join(', ')}` : '',
      reconReport ? `\n=== RECON REPORT (from worker's codebase exploration) ===\n${reconReport.substring(0, 3000)}\n===\n` : '',
      previousResultsStr,
      preferenceContext ? `\n${preferenceContext}` : '',
      ``,
      `Create a plan based on the recon report above. Be SPECIFIC — use exact file paths, function names, and concrete actions from the report.`,
      `Do NOT create generic steps like "explore codebase" — the recon is already done.`,
      ``,
      `Output ONLY valid JSON:`,
      `{`,
      `  "reasoning": "why this plan",`,
      `  "recurring": true/false,`,
      `  "interval_minutes": number or null,`,
      `  "cycle_goal": "..." or null,`,
      `  "completion_criteria": "..." or null,`,
      `  "steps": [{"description": "..."}]`,
      `}`,
      ``,
      `Set "recurring": true if this goal needs ongoing cycles.`,
      `Set "recurring": false if this is a one-time task.`,
      `Keep steps concrete and actionable. Output valid JSON only, no markdown fences.`,
    ].filter(l => l !== undefined).join('\n');

    console.log(`[Adversary] Generating plan for: ${goal.description}`);

    const response = await this.llm.complete({ prompt: planPrompt });
    if (response.error) {
      console.log(`[Adversary] Plan generation failed: ${response.error}`);
      this.goalManager.updateGoal(goalId, { status: 'failed' });
      this.activeGoals.delete(goalId);
      return;
    }

    const plan = this.parsePlanFromResult(response.content);
    if (plan && plan.steps.length > 0) {
      this.goalManager.setPlan(goalId, plan.steps, plan.reasoning, {
        recurring: plan.recurring,
        intervalMinutes: plan.intervalMinutes,
        cycleGoal: plan.cycleGoal,
        completionCriteria: plan.completionCriteria,
      });
      console.log(`[Adversary] Plan created: ${plan.steps.length} steps, recurring=${plan.recurring}`);
      await this.executeNextStep(goalId);
    } else {
      console.log(`[Adversary] Failed to parse plan from LLM response. First 500 chars:`);
      console.log(response.content.substring(0, 500));
      this.goalManager.updateGoal(goalId, { status: 'failed' });
      this.activeGoals.delete(goalId);
    }
  }

  // ── Private: Plan Refinement ──

  private async refinePlan(goalId: string): Promise<void> {
    const goal = this.goalManager.getGoal(goalId);
    if (!goal) return;

    const plan = this.goalManager.getCurrentPlan(goalId);
    if (!plan) return;

    const pendingSteps = plan.steps.filter(s => s.status === 'pending');
    if (pendingSteps.length === 0) return; // nothing to refine

    const completedSteps = plan.steps.filter(s => s.status === 'completed');
    if (completedSteps.length === 0) return; // no context to refine from

    const refinePrompt = [
      `You are an orchestrator reviewing a plan in progress.`,
      ``,
      `Goal: "${goal.description}"`,
      ``,
      `Completed steps:`,
      ...completedSteps.map(s => `  [done] Step ${s.order + 1}: ${s.description}\n    Result: ${(s.result || '').substring(0, 600)}`),
      ``,
      `Remaining steps:`,
      ...pendingSteps.map(s => `  [pending] Step ${s.order + 1}: ${s.description}`),
      ``,
      `Based on what the completed steps revealed, should the remaining steps be adjusted?`,
      `Output ONLY valid JSON:`,
      `{`,
      `  "needs_refinement": true | false,`,
      `  "reasoning": "why or why not",`,
      `  "refined_steps": [{"order": N, "description": "updated description"}]`,
      `}`,
      ``,
      `Rules:`,
      `- Only set needs_refinement=true if the completed results meaningfully change what remaining steps should do`,
      `- Use exact file paths and concrete details learned from completed steps`,
      `- Keep the same step order numbers — only update descriptions`,
      `- If steps should be removed, set description to "SKIP"`,
      `- If no changes needed, set needs_refinement=false and refined_steps=[]`,
    ].join('\n');

    const response = await this.llm.complete({ prompt: refinePrompt });
    if (response.error || !response.content) return;

    try {
      const parsed = this.extractJSON(response.content);
      if (!parsed || !parsed.needs_refinement || !Array.isArray(parsed.refined_steps)) return;

      let refinedCount = 0;
      for (const refined of parsed.refined_steps) {
        if (typeof refined.order !== 'number' || !refined.description) continue;
        const step = plan.steps.find(s => s.order === refined.order && s.status === 'pending');
        if (!step) continue;

        if (refined.description === 'SKIP') {
          this.goalManager.updatePlanStep(goalId, step.id, { status: 'skipped' });
          refinedCount++;
        } else if (refined.description !== step.description) {
          // Update step description in-place
          step.description = refined.description;
          refinedCount++;
        }
      }

      if (refinedCount > 0) {
        console.log(`[Adversary] Refined ${refinedCount} remaining step(s) based on results`);
        // Save the updated plan
        this.goalManager.getCurrentPlan(goalId); // trigger save via GoalManager
      }
    } catch {
      // Parse failed — continue with existing plan
    }
  }

  // ── Private: Worker Instruction Crafting via LLM ──

  private async craftWorkerInstruction(
    goal: AgentGoal,
    plan: AgentPlan,
    step: PlanStep
  ): Promise<string> {
    const agent = this.agentManager.getAgent(goal.agentId);
    const agentName = agent?.name || 'Worker';
    const workDir = goal.workingDirectory || this.bridge.getWorkingDirectory();
    const roots = this.bridge.getWorkspaceRoots();

    const craftPrompt = [
      `You are an orchestrator. Write a focused instruction for a worker agent.`,
      ``,
      `Goal: "${goal.description}"`,
      `Agent: ${agentName}`,
      `Working directory: ${workDir}`,
      roots.length > 0 ? `Workspace roots: ${roots.join(', ')}` : '',
      ``,
      `Full plan with results from completed steps:`,
      ...plan.steps.map(s => {
        const status = s.status === 'completed' ? '[done]' : s.status === 'failed' ? '[fail]' : s.id === step.id ? '[current]' : '[pending]';
        let line = `  ${status} Step ${s.order + 1}: ${s.description}`;
        if (s.status === 'completed' && s.result) {
          line += `\n    Result: ${s.result.substring(0, 800)}`;
        }
        return line;
      }),
      ``,
      `Current step: Step ${step.order + 1}: ${step.description}`,
      ``,
      `Write a clear, detailed instruction for the worker to complete ONLY this step.`,
      `CRITICAL: The worker has NO memory of previous steps. Include ALL relevant context from previous results — file paths, project structure, key findings — directly in your instruction.`,
      `The worker has full tool access (can read/write files, run commands, etc).`,
      `Output ONLY the instruction text, nothing else.`,
    ].filter(l => l !== undefined).join('\n');

    const response = await this.llm.complete({ prompt: craftPrompt });
    if (response.error || !response.content) {
      // Fallback to step description
      return step.description;
    }
    return response.content;
  }

  private async craftReplyInstruction(
    goal: AgentGoal,
    plan: AgentPlan,
    step: PlanStep,
    userAnswer: string
  ): Promise<string> {
    const workDir = goal.workingDirectory || this.bridge.getWorkingDirectory();

    const craftPrompt = [
      `You are an orchestrator. A worker agent was blocked on a step and asked the user a question.`,
      `The user has now answered. Write a NEW, concrete instruction for the worker to continue.`,
      ``,
      `Goal: "${goal.description}"`,
      `Working directory: ${workDir}`,
      `Step: "${step.description}"`,
      `Worker's previous result: "${(step.result || '').substring(0, 500)}"`,
      `Question asked: "${step.question}"`,
      `User's answer: "${userAnswer}"`,
      ``,
      `Write a clear instruction that INCORPORATES the user's answer directly.`,
      `Don't just say "the user said X" — rewrite the step instruction so it includes the concrete information.`,
      `For example, if the user said "it's in /foo/bar", write "Explore /foo/bar and ..."`,
      `Output ONLY the instruction text, nothing else.`,
    ].join('\n');

    const response = await this.llm.complete({ prompt: craftPrompt });
    if (response.error || !response.content) {
      // Fallback
      return `${step.description}\n\nAdditional context: ${step.question} Answer: ${userAnswer}`;
    }
    return response.content;
  }

  // ── Private: Step Evaluation via LLM ──

  private async evaluateStepResult(goalId: string, stepId: string, result: string): Promise<void> {
    const goal = this.goalManager.getGoal(goalId);
    if (!goal) {
      this.activeGoals.delete(goalId);
      return;
    }

    const plan = this.goalManager.getCurrentPlan(goalId);
    if (!plan) {
      this.activeGoals.delete(goalId);
      return;
    }

    const step = plan.steps.find(s => s.id === stepId);
    if (!step) {
      this.activeGoals.delete(goalId);
      return;
    }

    const evalPrompt = [
      `You are evaluating a worker agent's output for step ${step.order + 1} of a plan.`,
      ``,
      `Goal: "${goal.description}"`,
      `Step: "${step.description}"`,
      `Worker output: "${result.substring(0, 2000)}"`,
      ``,
      `Judge the result. Output ONLY valid JSON:`,
      `{`,
      `  "verdict": "PASS" | "RETRY" | "ESCALATE",`,
      `  "reasoning": "why",`,
      `  "refined_instruction": "if RETRY, what to do differently",`,
      `  "escalation_question": "if ESCALATE, what to ask the user"`,
      `}`,
      ``,
      `Rules:`,
      `- PASS: Step is satisfactorily completed`,
      `- RETRY: Step partially done or has fixable issues (max 2 retries per step)`,
      `- ESCALATE: Needs human decision, unclear requirements, or repeated failures`,
    ].join('\n');

    const response = await this.llm.complete({ prompt: evalPrompt });

    // Parse verdict
    let verdict = 'PASS';
    let refinedInstruction = '';
    let escalationQuestion = '';

    if (response.content) {
      try {
        const parsed = this.extractJSON(response.content);
        if (parsed) {
          verdict = parsed.verdict || 'PASS';
          refinedInstruction = parsed.refined_instruction || '';
          escalationQuestion = parsed.escalation_question || '';
        }
      } catch {
        // Parse failed — default to PASS
      }
    }

    const retryCount = this.retryMap.get(stepId) || 0;

    if (verdict === 'PASS') {
      this.retryMap.delete(stepId);
      this.goalManager.updatePlanStep(goalId, stepId, {
        status: 'completed',
        result,
        completedAt: Date.now(),
      });
      // Refine remaining steps based on what we learned
      await this.refinePlan(goalId);
      this.evaluateAndContinue(goalId);
    } else if (verdict === 'RETRY' && retryCount < 2) {
      this.retryMap.set(stepId, retryCount + 1);
      console.log(`[Adversary] Retrying step ${step.order + 1} (attempt ${retryCount + 2}/3): ${refinedInstruction.substring(0, 100)}`);

      // Re-execute with refined instruction
      this.goalManager.updatePlanStep(goalId, stepId, { status: 'pending' });
      await this.executeStepWithInstruction(goalId, step, refinedInstruction || step.description);
    } else {
      // ESCALATE (or max retries exceeded) — try to answer before bothering user
      this.retryMap.delete(stepId);
      const question = escalationQuestion || `Step ${step.order + 1} "${step.description}" needs your input after ${retryCount + 1} attempt(s). How should we proceed?`;
      await this.tryAnswerOrEscalate(goalId, stepId, question, result);
    }
  }

  // ── Private: Step Execution ──

  private async tryAnswerOrEscalate(goalId: string, stepId: string, question: string, workerResult: string): Promise<void> {
    const goal = this.goalManager.getGoal(goalId);
    if (!goal) {
      this.activeGoals.delete(goalId);
      return;
    }

    const plan = this.goalManager.getCurrentPlan(goalId);
    const step = plan?.steps.find(s => s.id === stepId);
    if (!plan || !step) {
      this.activeGoals.delete(goalId);
      return;
    }

    const preferenceContext = this.getPreferenceContext(goal.agentId);
    const workDir = goal.workingDirectory || this.bridge.getWorkingDirectory();

    const triagePrompt = [
      `You are an orchestrator managing a worker agent. The worker has raised a question.`,
      `Decide: can you answer this yourself, or must it go to the human user?`,
      ``,
      `Goal: "${goal.description}"`,
      `Working directory: ${workDir}`,
      `Step: "${step.description}"`,
      `Worker result so far: "${workerResult.substring(0, 1000)}"`,
      `Worker's question: "${question}"`,
      preferenceContext ? `\n${preferenceContext}` : '',
      ``,
      `Output ONLY valid JSON:`,
      `{`,
      `  "can_answer": true | false,`,
      `  "answer": "your answer if can_answer is true",`,
      `  "reasoning": "why you can or cannot answer"`,
      `}`,
      ``,
      `Rules:`,
      `- Answer if the information is in the goal, context, preferences, or can be reasonably inferred`,
      `- Answer if it's a simple factual/technical question (e.g. "which framework?" when the goal implies one)`,
      `- Do NOT answer if it requires the user's subjective preference, a policy decision, or information you truly don't have`,
      `- When in doubt, escalate to the user`,
    ].filter(l => l !== undefined).join('\n');

    const response = await this.llm.complete({ prompt: triagePrompt });

    let canAnswer = false;
    let answer = '';

    if (response.content) {
      try {
        const parsed = this.extractJSON(response.content);
        if (parsed) {
          canAnswer = parsed.can_answer === true;
          answer = parsed.answer || '';
        }
      } catch {
        // Parse failed — escalate to user
      }
    }

    if (canAnswer && answer) {
      console.log(`[Adversary] Auto-answering worker question: "${question.substring(0, 80)}"`);
      console.log(`[Adversary] Answer: ${answer.substring(0, 120)}`);

      // Re-dispatch step with the adversary's answer
      this.goalManager.updatePlanStep(goalId, stepId, {
        status: 'in_progress',
        question: null,
      });

      const agent = this.agentManager.getAgent(goal.agentId);
      if (!agent) {
        this.activeGoals.delete(goalId);
        return;
      }

      const workerInstruction = await this.craftReplyInstruction(goal, plan, step, answer);
      await this.executeStepWithInstruction(goalId, step, workerInstruction);
    } else {
      // Escalate to user
      this.goalManager.updatePlanStep(goalId, stepId, {
        status: 'blocked',
        question,
        result: workerResult,
      });
      eventBus.emit('question_raised', {
        agentId: goal.agentId,
        goalId,
        stepId,
        question,
      });
    }
  }

  private async executeNextStep(goalId: string): Promise<void> {
    const goal = this.goalManager.getGoal(goalId);
    if (!goal || goal.status !== 'active') {
      this.activeGoals.delete(goalId);
      return;
    }

    const agent = this.agentManager.getAgent(goal.agentId);
    if (!agent) {
      this.activeGoals.delete(goalId);
      return;
    }

    const plan = this.goalManager.getCurrentPlan(goalId);
    if (!plan) {
      this.activeGoals.delete(goalId);
      return;
    }

    const step = this.goalManager.getNextPendingStep(goalId);
    if (!step) {
      // All steps done — check recurring
      const allCompleted = plan.steps.every(s => s.status === 'completed' || s.status === 'skipped');
      if (allCompleted) {
        if (plan.recurring) {
          console.log(`[Adversary] Cycle complete for recurring goal: ${goal.description}`);
          this.activeGoals.delete(goalId);
        } else {
          this.goalManager.updateGoal(goalId, { status: 'completed' });
          console.log(`[Adversary] Goal completed: ${goal.description}`);
          this.activeGoals.delete(goalId);
        }
      } else {
        console.log(`[Adversary] Some steps failed, re-planning...`);
        await this.generatePlan(goalId);
      }
      return;
    }

    // Craft worker instruction via adversary LLM
    console.log(`[Adversary] Crafting instruction for step ${step.order + 1}: ${step.description}`);
    const workerInstruction = await this.craftWorkerInstruction(goal, plan, step);

    await this.executeStepWithInstruction(goalId, step, workerInstruction);
  }

  private async executeStepWithInstruction(goalId: string, step: PlanStep, workerInstruction: string): Promise<void> {
    const goal = this.goalManager.getGoal(goalId);
    if (!goal) {
      this.activeGoals.delete(goalId);
      return;
    }

    const agent = this.agentManager.getAgent(goal.agentId);
    if (!agent) {
      this.activeGoals.delete(goalId);
      return;
    }

    this.goalManager.updatePlanStep(goalId, step.id, { status: 'in_progress' });

    const plan = this.goalManager.getCurrentPlan(goalId);
    const prompt = this.buildWorkerPrompt(agent, goal, workerInstruction, plan || undefined, step.id);

    const task = this.taskManager.createTask(`[Step ${step.order + 1}] ${step.description}`);
    this.taskManager.assignAgent(task.id, agent.id);
    this.agentManager.assignTask(agent.id, task.id);

    this.goalManager.updatePlanStep(goalId, step.id, { taskId: task.id });
    this.stepTaskMap.set(task.id, { goalId, stepId: step.id });

    const result = await this.bridge.executeTask(agent.id, task.id, goal.maxTurnsPerStep, goal.workingDirectory, prompt);
    if (!result.success) {
      this.goalManager.updatePlanStep(goalId, step.id, {
        status: 'failed',
        result: `Failed to start: ${result.error}`,
        completedAt: Date.now(),
      });
      this.stepTaskMap.delete(task.id);
      this.evaluateAndContinue(goalId);
    }
  }

  private buildWorkerPrompt(agent: { name: string; systemPrompt?: string }, goal: AgentGoal, workerInstruction: string, plan?: AgentPlan, currentStepId?: string): string {
    const workDir = goal.workingDirectory || this.bridge.getWorkingDirectory();
    const roots = this.bridge.getWorkspaceRoots();
    const preferenceContext = this.getPreferenceContext(goal.agentId);

    const parts: string[] = [];
    parts.push(`<instruction>`);
    parts.push(`You are ${agent.name}, an autonomous agent.`);
    if (agent.systemPrompt) {
      parts.push(agent.systemPrompt);
    }

    // Include completed step results so the worker has context
    if (plan) {
      const completedSteps = plan.steps.filter(s => s.status === 'completed' && s.result && s.id !== currentStepId);
      if (completedSteps.length > 0) {
        parts.push(``);
        parts.push(`<prior_context>`);
        parts.push(`Results from previous steps (you have no memory of these — use this context):`);
        for (const s of completedSteps) {
          parts.push(`Step ${s.order + 1} "${s.description}": ${s.result!.substring(0, 600)}`);
        }
        parts.push(`</prior_context>`);
      }
    }

    parts.push(``);
    parts.push(`<worker_instruction>`);
    parts.push(workerInstruction);
    parts.push(`</worker_instruction>`);
    parts.push(``);
    parts.push(`Working directory: ${workDir}`);
    if (roots.length > 0) {
      parts.push(`Workspace roots: ${roots.join(', ')}`);
    }
    if (goal.constraints.length > 0) {
      parts.push(`Constraints: ${goal.constraints.join(', ')}`);
    }
    if (preferenceContext) {
      parts.push(`\n${preferenceContext}`);
    }
    parts.push(``);
    parts.push(`Complete the instruction above. Be concise.`);
    parts.push(`If you encounter genuine uncertainty, end with "[NEEDS_INPUT]: your question"`);
    parts.push(``);
    parts.push(`When done, end your response with a brief summary of what you did and what you found:`);
    parts.push(`<step_summary>`);
    parts.push(`ACTIONS: what you did`);
    parts.push(`RESULT: what happened`);
    parts.push(`KEY_INFO: any paths, names, or facts the next step needs to know`);
    parts.push(`</step_summary>`);
    parts.push(`</instruction>`);

    return parts.join('\n');
  }

  // ── Private: evaluate and continue ──

  private async evaluateAndContinue(goalId: string): Promise<void> {
    const goal = this.goalManager.getGoal(goalId);
    if (!goal || goal.status !== 'active') {
      this.activeGoals.delete(goalId);
      return;
    }

    const plan = this.goalManager.getCurrentPlan(goalId);
    if (!plan) {
      this.activeGoals.delete(goalId);
      return;
    }

    const nextStep = this.goalManager.getNextPendingStep(goalId);
    if (nextStep) {
      await this.executeNextStep(goalId);
    } else {
      const failed = plan.steps.filter(s => s.status === 'failed');
      const completed = plan.steps.filter(s => s.status === 'completed');
      const blocked = plan.steps.filter(s => s.status === 'blocked');

      if (blocked.length > 0) {
        this.activeGoals.delete(goalId);
        return;
      }

      if (failed.length === 0 && completed.length === plan.steps.length) {
        if (plan.recurring) {
          console.log(`[Adversary] Cycle complete for recurring goal: ${goal.description}`);
          this.activeGoals.delete(goalId);
        } else {
          this.goalManager.updateGoal(goalId, { status: 'completed' });
          console.log(`[Adversary] Goal completed: ${goal.description}`);
          this.activeGoals.delete(goalId);
        }
      } else if (failed.length > 0 && completed.length + failed.length === plan.steps.length) {
        console.log(`[Adversary] ${failed.length} steps failed, re-planning...`);
        await this.generatePlan(goalId);
      } else {
        this.activeGoals.delete(goalId);
      }
    }
  }

  // ── Private: Helpers ──

  private getPreferenceContext(agentId: string): string | undefined {
    return this.preferenceManager?.buildPreferenceContext(agentId) || undefined;
  }

  private async triggerPreferenceExtraction(
    agentId: string,
    agentQuestion: string,
    userAnswer: string,
    context: string
  ): Promise<void> {
    if (!this.preferenceManager) return;

    const extractionPrompt = this.preferenceManager.buildExtractionPrompt(agentId, {
      userMessage: userAnswer,
      agentMessage: agentQuestion,
      context,
    });

    // Use the adversary LLM for extraction (no tools needed)
    const response = await this.llm.complete({ prompt: extractionPrompt });
    if (response.content) {
      const extracted = this.preferenceManager.parseAndStoreExtraction(
        agentId,
        response.content,
        `Reply to: ${agentQuestion.substring(0, 60)}`
      );
      if (extracted.length > 0) {
        console.log(`[Adversary] Extracted ${extracted.length} preference(s) from reply`);
      }
    }
  }

  /**
   * Extract a JSON object from an LLM response, handling markdown fences and surrounding text.
   */
  private extractJSON(raw: string): any | null {
    // Strip markdown code fences
    const cleaned = raw.replace(/```(?:json)?\s*\n?/g, '').replace(/```\s*$/gm, '').trim();

    // 1. Try direct parse
    try {
      return JSON.parse(cleaned);
    } catch { /* not direct JSON */ }

    // 2. Balanced brace extraction (first { to its matching })
    const startIdx = cleaned.indexOf('{');
    if (startIdx !== -1) {
      let depth = 0;
      for (let i = startIdx; i < cleaned.length; i++) {
        if (cleaned[i] === '{') depth++;
        else if (cleaned[i] === '}') {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(cleaned.substring(startIdx, i + 1));
            } catch { break; }
          }
        }
      }
    }

    return null;
  }

  private parsePlanFromResult(result: string): {
    reasoning: string;
    steps: { description: string }[];
    recurring: boolean;
    intervalMinutes: number | null;
    cycleGoal: string | null;
    completionCriteria: string | null;
  } | null {
    const parsed = this.extractJSON(result);
    if (!parsed) return null;

    // Handle object with "steps" array
    if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
      return {
        reasoning: parsed.reasoning || 'Plan generated by adversary',
        steps: parsed.steps.map((s: any) => ({
          description: typeof s === 'string' ? s : s.description || String(s),
        })),
        recurring: parsed.recurring === true,
        intervalMinutes: typeof parsed.interval_minutes === 'number' ? parsed.interval_minutes : null,
        cycleGoal: parsed.cycle_goal || null,
        completionCriteria: parsed.completion_criteria || null,
      };
    }

    // Handle bare array
    if (Array.isArray(parsed) && parsed.length > 0) {
      return {
        reasoning: 'Plan generated by adversary',
        steps: parsed.map((s: any) => ({
          description: typeof s === 'string' ? s : s.description || String(s),
        })),
        recurring: false,
        intervalMinutes: null,
        cycleGoal: null,
        completionCriteria: null,
      };
    }

    return null;
  }
}

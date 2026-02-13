import * as readline from 'readline';
import { v4 as uuidv4 } from 'uuid';
import { AgentTrigger } from '../types';
import { NodeAdapter } from '../control/NodeAdapter';
import { AgentManager } from '../control/AgentManager';
import { TaskManager } from '../control/TaskManager';
import { ClaudeCodeBridge } from '../control/ClaudeCodeBridge';
import { GoalManager } from '../control/GoalManager';
import { PlannerLoop } from '../control/PlannerLoop';
import { TriggerScheduler } from '../control/TriggerScheduler';
import { PreferenceManager } from '../control/PreferenceManager';
import { ObservabilityModule } from '../observe/ObservabilityModule';
import { eventBus } from '../control/EventBus';

async function main() {
  const workingDirectory = process.argv[2] || process.cwd();
  console.log(`\n  Work Farm TUI`);
  console.log(`  project: ${workingDirectory}\n`);

  const runtime = new NodeAdapter({ workingDirectory });
  const agentManager = new AgentManager(runtime);
  const taskManager = new TaskManager(runtime);
  const goalManager = new GoalManager(runtime);

  await agentManager.initialize();
  await taskManager.initialize();
  await goalManager.initialize();

  const bridge = new ClaudeCodeBridge(runtime, agentManager, taskManager);
  await bridge.initialize();

  const preferenceManager = new PreferenceManager(runtime);
  // Load preferences for all existing agents
  for (const agent of agentManager.getAllAgents()) {
    await preferenceManager.loadForAgent(agent.id);
  }

  const plannerLoop = new PlannerLoop(goalManager, agentManager, taskManager, bridge);
  plannerLoop.setPreferenceManager(preferenceManager);
  const triggerScheduler = new TriggerScheduler();
  triggerScheduler.start(goalManager, plannerLoop);

  const observability = new ObservabilityModule(runtime);
  observability.start();

  // --- Event subscriptions for live output ---

  eventBus.on('session_message', (event) => {
    const { message, agentId } = event.data;
    const agent = agentId ? agentManager.getAgent(agentId) : null;
    const name = agent?.name || 'agent';

    if (message.type === 'assistant') {
      process.stdout.write(`  [${name}] ${message.content}\n`);
    } else if (message.type === 'tool_use') {
      const toolName = message.metadata?.toolName || 'tool';
      process.stdout.write(`  [${name}] using ${toolName}...\n`);
    }
  });

  eventBus.on('permission_requested', (event) => {
    const { agentId, toolName } = event.data;
    const agent = agentManager.getAgent(agentId);
    console.log(`\n  ** PERMISSION: ${agent?.name} needs "${toolName}" **`);
    console.log(`     approve ${agent?.name?.toLowerCase()} ${toolName}`);
    console.log(`     deny ${agent?.name?.toLowerCase()}\n`);
  });

  eventBus.on('task_completed', (event) => {
    const { task } = event.data;
    console.log(`\n  Task completed: ${task.description.substring(0, 60)}`);
    if (task.result) {
      console.log(`  Result: ${task.result.substring(0, 200)}`);
    }
    console.log();
  });

  eventBus.on('task_failed', (event) => {
    const { task, error } = event.data;
    console.log(`\n  Task failed: ${task.description.substring(0, 60)}`);
    console.log(`  Error: ${error}\n`);
  });

  eventBus.on('step_started', (event) => {
    const { description, agentId } = event.data;
    const agent = agentId ? agentManager.getAgent(agentId) : null;
    console.log(`  [${agent?.name || 'agent'}] Step started: ${description}`);
  });

  eventBus.on('step_completed', (event) => {
    const { result, agentId } = event.data;
    const agent = agentId ? agentManager.getAgent(agentId) : null;
    console.log(`  [${agent?.name || 'agent'}] Step completed: ${(result || '').substring(0, 100)}`);
  });

  eventBus.on('step_failed', (event) => {
    const { error, agentId } = event.data;
    const agent = agentId ? agentManager.getAgent(agentId) : null;
    console.log(`  [${agent?.name || 'agent'}] Step failed: ${(error || '').substring(0, 100)}`);
  });

  eventBus.on('question_raised', (event) => {
    const { agentId, question } = event.data;
    const agent = agentId ? agentManager.getAgent(agentId) : null;
    const name = agent?.name || 'agent';
    console.log(`\n  ** ${name} needs input **`);
    console.log(`  ${question}`);
    console.log(`\n  Use: reply ${name.toLowerCase()} <your answer>\n`);
  });

  eventBus.on('preference_extracted', (event) => {
    const { agentId, preference } = event.data;
    const agent = agentId ? agentManager.getAgent(agentId) : null;
    console.log(`  [${agent?.name || 'agent'}] Learned preference: ${preference.key} = ${preference.value} (${preference.confidence})`);
  });

  // --- REPL ---

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  function prompt() {
    rl.question('workfarm> ', (line) => {
      handleCommand(line).then(prompt);
    });
  }

  async function handleCommand(line: string): Promise<void> {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    if (!cmd) return;

    switch (cmd) {
      case 'hire': {
        const name = parts.length > 1 ? parts.slice(1).join(' ') : undefined;
        const agent = agentManager.hireAgent(name);
        await preferenceManager.loadForAgent(agent.id);
        console.log(`  Hired ${agent.name}`);
        break;
      }

      case 'fire': {
        const agent = findAgent(parts[1]);
        if (!agent) break;
        agentManager.fireAgent(agent.id);
        console.log(`  Fired ${agent.name}`);
        break;
      }

      case 'agents': {
        const agents = agentManager.getAllAgents();
        if (agents.length === 0) {
          console.log('  No agents. Use "hire" to hire one.');
          break;
        }
        for (const a of agents) {
          const tools = a.approvedTools.join(', ');
          const goal = goalManager.getActiveGoal(a.id);
          const goalStr = goal ? `  goal: ${goal.description.substring(0, 40)}` : '';
          console.log(`  ${a.name}  [${a.state}]  tasks: ${a.tasksCompleted}  tools: ${tools}${goalStr}`);
        }
        break;
      }

      case 'assign': {
        const agentName = parts[1];
        const desc = parts.slice(2).join(' ');
        if (!agentName || !desc) {
          console.log('  Usage: assign <agent> <task description>');
          break;
        }
        const agent = findAgent(agentName);
        if (!agent) break;
        if (agent.currentTaskId) {
          console.log(`  ${agent.name} is busy.`);
          break;
        }
        const task = taskManager.createTask(desc);
        taskManager.assignAgent(task.id, agent.id);
        agentManager.assignTask(agent.id, task.id);
        const result = await bridge.executeTask(agent.id, task.id);
        if (!result.success) {
          console.log(`  Error: ${result.error}`);
        }
        break;
      }

      case 'approve': {
        const agentName = parts[1];
        const toolName = parts[2];
        if (!agentName || !toolName) {
          console.log('  Usage: approve <agent> <toolName>');
          break;
        }
        const agent = findAgent(agentName);
        if (!agent) break;
        await bridge.approveToolPermission(agent.id, toolName);
        console.log(`  Approved ${toolName} for ${agent.name}`);
        break;
      }

      case 'deny': {
        const agentName = parts[1];
        if (!agentName) {
          console.log('  Usage: deny <agent>');
          break;
        }
        const agent = findAgent(agentName);
        if (!agent) break;
        bridge.denyToolPermission(agent.id);
        console.log(`  Denied permissions for ${agent.name}`);
        break;
      }

      case 'tasks': {
        const tasks = taskManager.getAllTasks();
        if (tasks.length === 0) {
          console.log('  No tasks.');
          break;
        }
        for (const t of tasks) {
          const agentName = t.assignedAgentId
            ? agentManager.getAgent(t.assignedAgentId)?.name || '?'
            : '-';
          console.log(`  [${t.status}] ${t.description.substring(0, 50)}  (${agentName})`);
        }
        break;
      }

      // --- Goal commands ---

      case 'goal': {
        const agentName = parts[1];
        const desc = parts.slice(2).join(' ');
        if (!agentName || !desc) {
          console.log('  Usage: goal <agent> <description>');
          break;
        }
        const agent = findAgent(agentName);
        if (!agent) break;
        const goal = goalManager.createGoal(agent.id, desc);
        console.log(`  Goal created for ${agent.name}: ${goal.description}`);
        console.log(`  Goal ID: ${goal.id.substring(0, 8)}`);
        break;
      }

      case 'goals': {
        const agentName = parts[1];
        let goals;
        if (agentName) {
          const agent = findAgent(agentName);
          if (!agent) break;
          goals = goalManager.getGoalsForAgent(agent.id);
        } else {
          goals = goalManager.getAllGoals();
        }
        if (goals.length === 0) {
          console.log('  No goals.');
          break;
        }
        for (const g of goals) {
          const agent = agentManager.getAgent(g.agentId);
          const plan = goalManager.getCurrentPlan(g.id);
          const planStr = plan ? `  plan: v${plan.version} (${plan.steps.length} steps)` : '';
          console.log(`  [${g.status}] ${agent?.name || '?'}: ${g.description.substring(0, 50)}${planStr}`);
        }
        break;
      }

      case 'constrain': {
        const agentName = parts[1];
        const text = parts.slice(2).join(' ');
        if (!agentName || !text) {
          console.log('  Usage: constrain <agent> <constraint text>');
          break;
        }
        const agent = findAgent(agentName);
        if (!agent) break;
        const goal = goalManager.getActiveGoal(agent.id);
        if (!goal) {
          console.log(`  ${agent.name} has no active goal.`);
          break;
        }
        goal.constraints.push(text);
        goalManager.updateGoal(goal.id, { constraints: goal.constraints });
        console.log(`  Constraint added to ${agent.name}'s goal: ${text}`);
        break;
      }

      case 'plan': {
        const agentName = parts[1];
        if (!agentName) {
          console.log('  Usage: plan <agent>');
          break;
        }
        const agent = findAgent(agentName);
        if (!agent) break;
        const goal = goalManager.getActiveGoal(agent.id);
        if (!goal) {
          console.log(`  ${agent.name} has no active goal.`);
          break;
        }
        const plan = goalManager.getCurrentPlan(goal.id);
        if (!plan) {
          console.log(`  ${agent.name} has no plan yet. Use "wake" to start.`);
          break;
        }
        console.log(`  Plan v${plan.version} for: ${goal.description}`);
        console.log(`  Reasoning: ${plan.reasoning}`);
        if (plan.recurring) {
          console.log(`  Recurring: yes${plan.intervalMinutes ? ` (every ${plan.intervalMinutes} min)` : ''}`);
          if (plan.cycleGoal) console.log(`  Cycle goal: ${plan.cycleGoal}`);
          if (plan.completionCriteria) console.log(`  Done when: ${plan.completionCriteria}`);
        }
        console.log();
        for (const step of plan.steps) {
          const icon = step.status === 'completed' ? '[done]'
            : step.status === 'failed' ? '[FAIL]'
            : step.status === 'in_progress' ? '[>>> ]'
            : step.status === 'skipped' ? '[skip]'
            : step.status === 'blocked' ? '[?!? ]'
            : '[    ]';
          console.log(`  ${icon} Step ${step.order + 1}: ${step.description}`);
          if (step.question) {
            console.log(`        Question: ${step.question}`);
          }
          if (step.result) {
            console.log(`        Result: ${step.result.substring(0, 120)}`);
          }
        }
        break;
      }

      case 'wake': {
        const agentName = parts[1];
        if (!agentName) {
          console.log('  Usage: wake <agent>');
          break;
        }
        const agent = findAgent(agentName);
        if (!agent) break;
        const goal = goalManager.getActiveGoal(agent.id) ||
          goalManager.getGoalsForAgent(agent.id).find(g => g.status === 'paused');
        if (!goal) {
          console.log(`  ${agent.name} has no active or paused goal.`);
          break;
        }
        console.log(`  Waking ${agent.name} for goal: ${goal.description.substring(0, 50)}`);
        await plannerLoop.wake(goal.id);
        break;
      }

      case 'pause': {
        const agentName = parts[1];
        if (!agentName) {
          console.log('  Usage: pause <agent>');
          break;
        }
        const agent = findAgent(agentName);
        if (!agent) break;
        const goal = goalManager.getActiveGoal(agent.id);
        if (!goal) {
          console.log(`  ${agent.name} has no active goal.`);
          break;
        }
        plannerLoop.pause(goal.id);
        console.log(`  Paused ${agent.name}'s goal: ${goal.description.substring(0, 50)}`);
        break;
      }

      case 'talk': {
        const agentName = parts[1];
        const message = parts.slice(2).join(' ');
        if (!agentName || !message) {
          console.log('  Usage: talk <agent> <message>');
          break;
        }
        const agent = findAgent(agentName);
        if (!agent) break;

        // Build context from goal/plan/activity
        const goal = goalManager.getActiveGoal(agent.id);
        let context = `You are ${agent.name}. The user wants to talk to you about your progress.`;
        if (goal) {
          context += `\n\nYour current goal: ${goal.description}`;
          const plan = goalManager.getCurrentPlan(goal.id);
          if (plan) {
            context += `\nPlan (v${plan.version}):`;
            for (const step of plan.steps) {
              context += `\n  [${step.status}] Step ${step.order + 1}: ${step.description}`;
              if (step.result) context += ` — ${step.result.substring(0, 100)}`;
            }
          }
        }
        const summary = await observability.getAgentSummary(agent.id, 10);
        if (summary !== 'No activity recorded.') {
          context += `\n\nRecent activity:\n${summary}`;
        }

        const result = await bridge.startConversation(agent.id, message, context);
        if (!result.success) {
          console.log(`  Error: ${result.error}`);
        }
        break;
      }

      case 'log': {
        const agentName = parts[1];
        const count = parseInt(parts[2]) || 20;
        if (!agentName) {
          console.log('  Usage: log <agent> [count]');
          break;
        }
        const agent = findAgent(agentName);
        if (!agent) break;
        const summary = await observability.getAgentSummary(agent.id, count);
        console.log(`  Activity log for ${agent.name}:`);
        console.log(summary.split('\n').map(l => `  ${l}`).join('\n'));
        break;
      }

      case 'prompt': {
        const agentName = parts[1];
        const text = parts.slice(2).join(' ');
        if (!agentName || !text) {
          console.log('  Usage: prompt <agent> <system prompt text>');
          break;
        }
        const agent = findAgent(agentName);
        if (!agent) break;
        agentManager.setSystemPrompt(agent.id, text);
        console.log(`  System prompt set for ${agent.name}`);
        break;
      }

      case 'schedule': {
        const agentName = parts[1];
        const minutes = parseInt(parts[2]);
        if (!agentName || isNaN(minutes) || minutes <= 0) {
          console.log('  Usage: schedule <agent> <minutes>');
          break;
        }
        const agent = findAgent(agentName);
        if (!agent) break;
        const goal = goalManager.getActiveGoal(agent.id);
        if (!goal) {
          console.log(`  ${agent.name} has no active goal.`);
          break;
        }
        // Remove existing triggers for this goal
        const existing = goalManager.getTriggersForGoal(goal.id);
        for (const t of existing) {
          triggerScheduler.removeTrigger(t.id);
        }
        const trigger: AgentTrigger = {
          id: uuidv4(),
          agentId: agent.id,
          goalId: goal.id,
          type: 'interval',
          intervalMs: minutes * 60 * 1000,
          enabled: true,
          lastFiredAt: null,
          nextFireAt: Date.now() + minutes * 60 * 1000,
          createdAt: Date.now(),
        };
        triggerScheduler.addTrigger(trigger);
        console.log(`  Scheduled ${agent.name} to wake every ${minutes} minute(s)`);
        break;
      }

      case 'unschedule': {
        const agentName = parts[1];
        if (!agentName) {
          console.log('  Usage: unschedule <agent>');
          break;
        }
        const agent = findAgent(agentName);
        if (!agent) break;
        const triggers = goalManager.getTriggersForAgent(agent.id);
        if (triggers.length === 0) {
          console.log(`  ${agent.name} has no triggers.`);
          break;
        }
        for (const t of triggers) {
          triggerScheduler.removeTrigger(t.id);
        }
        console.log(`  Removed ${triggers.length} trigger(s) for ${agent.name}`);
        break;
      }

      case 'reply': {
        const agentName = parts[1];
        const answer = parts.slice(2).join(' ');
        if (!agentName || !answer) {
          console.log('  Usage: reply <agent> <answer>');
          break;
        }
        const agent = findAgent(agentName);
        if (!agent) break;
        const goal = goalManager.getActiveGoal(agent.id);
        if (!goal) {
          console.log(`  ${agent.name} has no active goal.`);
          break;
        }
        const blockedStep = goalManager.getBlockedStep(goal.id);
        if (!blockedStep) {
          console.log(`  ${agent.name} has no pending question.`);
          break;
        }
        console.log(`  Sending reply to ${agent.name}...`);
        await plannerLoop.reply(goal.id, answer);
        break;
      }

      case 'prefs': {
        const agentName = parts[1];
        if (!agentName) {
          console.log('  Usage: prefs <agent>');
          break;
        }
        const agent = findAgent(agentName);
        if (!agent) break;
        const prefs = preferenceManager.getPreferences(agent.id);
        if (prefs.length === 0) {
          console.log(`  ${agent.name} has no learned preferences.`);
          break;
        }
        console.log(`  Preferences for ${agent.name}:`);
        for (const p of prefs) {
          const usage = p.usedCount > 0 ? ` (used ${p.usedCount}x)` : '';
          console.log(`    [${p.category}] ${p.key}: ${p.value}  — ${p.confidence}${usage}`);
        }
        break;
      }

      case 'forget': {
        const agentName = parts[1];
        const key = parts[2];
        if (!agentName || !key) {
          console.log('  Usage: forget <agent> <preference_key>');
          break;
        }
        const agent = findAgent(agentName);
        if (!agent) break;
        const removed = preferenceManager.removePreference(agent.id, key);
        if (removed) {
          console.log(`  Removed preference "${key}" for ${agent.name}`);
        } else {
          console.log(`  No preference "${key}" found for ${agent.name}`);
        }
        break;
      }

      case 'help': {
        console.log('  Commands:');
        console.log('    hire [name]                   Hire an agent');
        console.log('    fire <agent>                  Fire an agent');
        console.log('    agents                        List agents');
        console.log('    assign <agent> <task>         Assign a task');
        console.log('    approve <agent> <tool>        Approve a tool permission');
        console.log('    deny <agent>                  Deny pending permissions');
        console.log('    tasks                         List all tasks');
        console.log();
        console.log('    goal <agent> <description>    Create a goal for an agent');
        console.log('    goals [agent]                 List goals');
        console.log('    constrain <agent> <text>      Add constraint to active goal');
        console.log('    plan <agent>                  Show current plan');
        console.log('    wake <agent>                  Trigger goal execution');
        console.log('    pause <agent>                 Pause goal execution');
        console.log('    talk <agent> <message>        Talk to agent about progress');
        console.log('    reply <agent> <answer>        Reply to agent question');
        console.log('    log <agent> [n]               Show last N events (default 20)');
        console.log('    prompt <agent> <text>         Set agent system prompt');
        console.log('    prefs <agent>                 Show learned preferences');
        console.log('    forget <agent> <key>          Remove a preference');
        console.log('    schedule <agent> <minutes>    Set interval trigger');
        console.log('    unschedule <agent>            Remove triggers');
        console.log();
        console.log('    quit                          Exit');
        break;
      }

      case 'quit':
      case 'exit': {
        console.log('  Shutting down...');
        triggerScheduler.stop();
        observability.stop();
        plannerLoop.destroy();
        bridge.destroy();
        runtime.destroy();
        rl.close();
        process.exit(0);
      }

      default:
        console.log(`  Unknown command: ${cmd}. Type "help" for available commands.`);
    }
  }

  function findAgent(nameOrPrefix: string | undefined): ReturnType<typeof agentManager.getAgent> {
    if (!nameOrPrefix) {
      console.log('  Agent name required.');
      return undefined;
    }
    const lower = nameOrPrefix.toLowerCase();
    const agent = agentManager.getAllAgents().find(
      (a) => a.name.toLowerCase() === lower || a.name.toLowerCase().startsWith(lower)
    );
    if (!agent) {
      console.log(`  Agent "${nameOrPrefix}" not found.`);
    }
    return agent;
  }

  console.log('  Type "help" for commands.\n');
  prompt();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

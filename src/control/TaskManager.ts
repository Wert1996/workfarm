import { v4 as uuidv4 } from 'uuid';
import { Task, TaskStatus } from '../types';
import { eventBus } from './EventBus';

export class TaskManager {
  private tasks: Map<string, Task> = new Map();

  async initialize(): Promise<void> {
    const savedTasks = await window.workfarm.loadTasks();
    for (const task of savedTasks) {
      this.tasks.set(task.id, task);
    }
  }

  async save(): Promise<void> {
    const tasks = Array.from(this.tasks.values());
    await window.workfarm.saveTasks(tasks);
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  getActiveTasks(): Task[] {
    return this.getAllTasks().filter(
      (t) => t.status === 'pending' || t.status === 'in_progress'
    );
  }

  getTasksByAgent(agentId: string): Task[] {
    return this.getAllTasks().filter((t) => t.assignedAgentId === agentId);
  }

  createTask(description: string): Task {
    const task: Task = {
      id: uuidv4(),
      description,
      assignedAgentId: null,
      status: 'pending',
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      result: null,
      tokensUsed: 0,
      logs: [],
    };

    this.tasks.set(task.id, task);
    eventBus.emit('task_created', { task });
    this.save();

    return task;
  }

  assignAgent(taskId: string, agentId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.assignedAgentId = agentId;
    eventBus.emit('task_assigned', { taskId, agentId, task });
    this.save();
  }

  startTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'in_progress';
    task.startedAt = Date.now();
    this.addLog(taskId, 'Task started');
    eventBus.emit('task_started', { taskId, task });
    this.save();
  }

  completeTask(taskId: string, result: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'completed';
    task.completedAt = Date.now();
    task.result = result;
    this.addLog(taskId, 'Task completed');
    eventBus.emit('task_completed', { taskId, task });
    this.save();
  }

  failTask(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'failed';
    task.completedAt = Date.now();
    task.result = `Error: ${error}`;
    this.addLog(taskId, `Task failed: ${error}`);
    eventBus.emit('task_failed', { taskId, task, error });
    this.save();
  }

  addTokensUsed(taskId: string, tokens: number): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.tokensUsed += tokens;
  }

  addLog(taskId: string, message: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.logs.push({
      timestamp: Date.now(),
      message,
    });

    // Keep last 100 logs
    if (task.logs.length > 100) {
      task.logs = task.logs.slice(-100);
    }
  }

  deleteTask(taskId: string): boolean {
    const deleted = this.tasks.delete(taskId);
    if (deleted) this.save();
    return deleted;
  }
}

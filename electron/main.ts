import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';

let mainWindow: BrowserWindow | null = null;
const claudeProcesses: Map<string, ChildProcess> = new Map();
const sessionProcesses: Map<string, ChildProcess> = new Map();

// Data directory for persistence
const dataDir = path.join(app.getPath('userData'), 'workfarm-data');
const agentsFile = path.join(dataDir, 'agents.json');
const tasksFile = path.join(dataDir, 'tasks.json');
const memoryDir = path.join(dataDir, 'memory');

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#1a1a2e',
    title: 'Work Farm',
  });

  // In development, load from vite dev server
  if (process.env.NODE_ENV !== 'production') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Kill all claude processes on close
    claudeProcesses.forEach((proc) => proc.kill());
    claudeProcesses.clear();
    sessionProcesses.forEach((proc) => proc.kill());
    sessionProcesses.clear();
  });
}

app.whenReady().then(() => {
  ensureDataDir();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ============ IPC Handlers ============

// Persistence handlers
ipcMain.handle('load-agents', async () => {
  try {
    if (fs.existsSync(agentsFile)) {
      return JSON.parse(fs.readFileSync(agentsFile, 'utf-8'));
    }
    return [];
  } catch (error) {
    console.error('Error loading agents:', error);
    return [];
  }
});

ipcMain.handle('save-agents', async (_event, agents: any[]) => {
  try {
    fs.writeFileSync(agentsFile, JSON.stringify(agents, null, 2));
    return { success: true };
  } catch (error) {
    console.error('Error saving agents:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('load-tasks', async () => {
  try {
    if (fs.existsSync(tasksFile)) {
      return JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
    }
    return [];
  } catch (error) {
    console.error('Error loading tasks:', error);
    return [];
  }
});

ipcMain.handle('save-tasks', async (_event, tasks: any[]) => {
  try {
    fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2));
    return { success: true };
  } catch (error) {
    console.error('Error saving tasks:', error);
    return { success: false, error: String(error) };
  }
});

// Agent memory handlers
ipcMain.handle('load-agent-memory', async (_event, agentId: string) => {
  try {
    const memoryFile = path.join(memoryDir, `${agentId}.json`);
    if (fs.existsSync(memoryFile)) {
      return JSON.parse(fs.readFileSync(memoryFile, 'utf-8'));
    }
    return { conversations: [], context: {} };
  } catch (error) {
    console.error('Error loading agent memory:', error);
    return { conversations: [], context: {} };
  }
});

ipcMain.handle('save-agent-memory', async (_event, agentId: string, memory: any) => {
  try {
    const memoryFile = path.join(memoryDir, `${agentId}.json`);
    fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2));
    return { success: true };
  } catch (error) {
    console.error('Error saving agent memory:', error);
    return { success: false, error: String(error) };
  }
});

// Claude Code integration handlers
ipcMain.handle('claude-code-execute', async (_event, options: {
  agentId: string;
  prompt: string;
  workingDirectory: string;
  thinkingBudget?: 'low' | 'medium' | 'high';
}) => {
  const { agentId, prompt, workingDirectory, thinkingBudget = 'medium' } = options;

  return new Promise((resolve) => {
    // Build claude command with appropriate flags
    const args = ['--print', '--output-format', 'json'];

    // Map thinking budget to model parameters
    if (thinkingBudget === 'high') {
      args.push('--model', 'opus');
    } else if (thinkingBudget === 'low') {
      args.push('--model', 'haiku');
    }

    args.push(prompt);

    const claude = spawn('claude', args, {
      cwd: workingDirectory,
      shell: true,
      env: { ...process.env },
    });

    claudeProcesses.set(agentId, claude);

    let stdout = '';
    let stderr = '';

    claude.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      // Send progress updates to renderer
      mainWindow?.webContents.send('claude-code-progress', {
        agentId,
        chunk,
        type: 'stdout'
      });
    });

    claude.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      mainWindow?.webContents.send('claude-code-progress', {
        agentId,
        chunk,
        type: 'stderr'
      });
    });

    claude.on('close', (code) => {
      claudeProcesses.delete(agentId);

      let result: any = { stdout, stderr, exitCode: code };

      // Try to parse JSON output
      try {
        result.parsed = JSON.parse(stdout);
      } catch {
        result.parsed = null;
      }

      resolve(result);
    });

    claude.on('error', (error) => {
      claudeProcesses.delete(agentId);
      resolve({
        stdout: '',
        stderr: error.message,
        exitCode: -1,
        error: error.message
      });
    });
  });
});

ipcMain.handle('claude-code-cancel', async (_event, agentId: string) => {
  const proc = claudeProcesses.get(agentId);
  if (proc) {
    proc.kill('SIGTERM');
    claudeProcesses.delete(agentId);
    return { success: true };
  }
  return { success: false, error: 'No process found' };
});

// Get working directory
ipcMain.handle('get-working-directory', async () => {
  return process.cwd();
});

// Open file dialog
ipcMain.handle('select-directory', async () => {
  const { dialog } = await import('electron');
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory']
  });
  if (result.canceled) {
    return null;
  }
  return result.filePaths[0];
});

// ============ Session IPC Handlers ============

function spawnSessionProcess(
  sessionId: string,
  args: string[],
  workingDirectory: string
): void {
  const claude = spawn('claude', args, {
    cwd: workingDirectory,
    env: { ...process.env },
  });

  sessionProcesses.set(sessionId, claude);

  let lineBuffer = '';

  claude.stdout.on('data', (data: Buffer) => {
    lineBuffer += data.toString();
    const lines = lineBuffer.split('\n');
    // Keep the last incomplete line in the buffer
    lineBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed);
        mainWindow?.webContents.send('claude-session-event', {
          sessionId,
          event,
        });
      } catch {
        // Non-JSON output, send as a system message
        mainWindow?.webContents.send('claude-session-event', {
          sessionId,
          event: { type: 'system', content: trimmed },
        });
      }
    }
  });

  claude.stderr.on('data', (data: Buffer) => {
    const chunk = data.toString();
    mainWindow?.webContents.send('claude-session-event', {
      sessionId,
      event: { type: 'system', subtype: 'stderr', content: chunk },
    });
  });

  claude.on('close', (code: number | null) => {
    // Flush remaining buffer
    if (lineBuffer.trim()) {
      try {
        const event = JSON.parse(lineBuffer.trim());
        mainWindow?.webContents.send('claude-session-event', {
          sessionId,
          event,
        });
      } catch {
        // ignore
      }
    }

    sessionProcesses.delete(sessionId);
    mainWindow?.webContents.send('claude-session-event', {
      sessionId,
      event: { type: 'result', subtype: 'close', exitCode: code },
    });
  });

  claude.on('error', (error: Error) => {
    sessionProcesses.delete(sessionId);
    mainWindow?.webContents.send('claude-session-event', {
      sessionId,
      event: { type: 'result', subtype: 'error', error: error.message },
    });
  });
}

ipcMain.handle('claude-session-start', async (_event, options: {
  sessionId: string;
  prompt: string;
  workingDirectory: string;
  systemPrompt?: string;
}) => {
  const { sessionId, prompt, workingDirectory, systemPrompt } = options;

  const args = ['--print', '--output-format', 'stream-json', '--session-id', sessionId];

  if (systemPrompt) {
    args.push('--append-system-prompt', systemPrompt);
  }

  args.push(prompt);

  spawnSessionProcess(sessionId, args, workingDirectory);
  return { success: true, sessionId };
});

ipcMain.handle('claude-session-send', async (_event, options: {
  sessionId: string;
  message: string;
  workingDirectory: string;
}) => {
  const { sessionId, message, workingDirectory } = options;

  // Kill existing process for this session if still running
  const existing = sessionProcesses.get(sessionId);
  if (existing) {
    existing.kill('SIGTERM');
    sessionProcesses.delete(sessionId);
  }

  const args = ['--print', '--resume', sessionId, '--output-format', 'stream-json', message];

  spawnSessionProcess(sessionId, args, workingDirectory);
  return { success: true };
});

ipcMain.handle('claude-session-stop', async (_event, sessionId: string) => {
  const proc = sessionProcesses.get(sessionId);
  if (proc) {
    proc.kill('SIGTERM');
    sessionProcesses.delete(sessionId);
    return { success: true };
  }
  return { success: false, error: 'No session process found' };
});

ipcMain.handle('ensure-skills', async (_event, workingDirectory: string) => {
  try {
    // Read SKILL.md from the workfarm app source
    const skillSource = path.join(
      app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..'),
      '.claude', 'skills', 'find-skills', 'SKILL.md'
    );

    if (!fs.existsSync(skillSource)) {
      return { success: false, error: `Skill source not found at ${skillSource}` };
    }

    const skillContent = fs.readFileSync(skillSource, 'utf-8');

    // Write to the target project directory
    const targetDir = path.join(workingDirectory, '.claude', 'skills', 'find-skills');
    fs.mkdirSync(targetDir, { recursive: true });

    const targetFile = path.join(targetDir, 'SKILL.md');
    fs.writeFileSync(targetFile, skillContent);

    return { success: true, skillContent };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

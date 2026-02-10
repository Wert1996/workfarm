# Work Farm

A desktop application that reimagines how we work with AI agents. Instead of typing commands, you manage a cozy virtual office where AI workers handle tasks autonomously.

![Work Farm Screenshot](screenshot.png)

## Concept

Work Farm treats AI as labor, not a chat interface. You are the **steward** of a small team of AI agents who:

- Wander around a pixel-art office space
- Accept tasks you assign to them
- Work autonomously using Claude Code
- Report back with results

The goal is to make AI work feel tangible and manageable—like running a small studio rather than wrestling with a terminal.

## Features

- **Isometric pixel-art workspace** - A warm, cozy office with desks, plants, lamps, and a rug
- **Autonomous agents** - Hire workers who wander around and have personality
- **Token budgets** - Set spending limits for each agent (1k-50k tokens)
- **Task management** - Assign work by clicking on agents, track progress in the task bar
- **Claude Code integration** - Agents execute real work via Claude Code CLI
- **Persistent memory** - Agents remember past conversations and context

## Installation

```bash
# Clone the repo
git clone https://github.com/yourusername/workfarm.git
cd workfarm

# Install dependencies
npm install

# Run in development mode
npm run dev
```

## Usage

1. **Select a project** - Click "Select Project" to choose a working directory
2. **Hire agents** - Click "+ Hire Agent" to add workers to your office
3. **Assign tasks** - Click on an agent, type a task description, and click "Assign Task"
4. **Monitor progress** - Watch the task bar at the bottom for status updates
5. **View results** - Click on completed tasks to see the output

### Agent Controls

When you click on an agent, you can:

- **Adjust token budget** - Slide to set max tokens per task (affects cost/thoroughness)
- **View stats** - See tasks completed and total tokens used
- **Assign new tasks** - Describe what you want done
- **Fire the agent** - Remove them from your team

## Tech Stack

- **Electron** - Desktop application shell
- **Phaser 3** - Game engine for the isometric world
- **TypeScript** - Type-safe code throughout
- **Claude Code CLI** - AI task execution

## Project Structure

```
workfarm/
├── electron/           # Electron main process
│   ├── main.ts         # Window management, IPC handlers
│   └── preload.ts      # Secure bridge to renderer
├── src/
│   ├── main.ts         # Phaser game initialization
│   ├── types/          # TypeScript interfaces
│   ├── control/        # Business logic
│   │   ├── AgentManager.ts
│   │   ├── TaskManager.ts
│   │   └── ClaudeCodeBridge.ts
│   └── game/
│       ├── config.ts   # Colors, grid settings
│       └── scenes/     # Phaser scenes
│           ├── BootScene.ts   # Asset generation
│           ├── MainScene.ts   # Isometric world
│           └── UIScene.ts     # DOM-based UI
└── package.json
```

## Development

```bash
# Run development mode (hot reload)
npm run dev

# Build for production
npm run build

# Package as distributable app
npm run package
```

## Requirements

- Node.js 18+
- Claude Code CLI installed and authenticated (`claude` command available)

## License

MIT

## Acknowledgments

- Inspired by management sims and the idea that AI work should feel tangible
- Built with Claude Code

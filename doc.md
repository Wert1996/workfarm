# **Cognitive Operations System (COS)**

Called Work Farm as a pseudonym

*A truthful interface for agent-driven work*

---

## 1. Purpose

This system removes the illusion that users are “coding”.

Instead, it treats modern work as:

* giving intent
* allocating thinking resources
* supervising autonomous agents
* intervening only when needed

The user acts as a **steward / operator**, not a programmer.

---

## 2. Core Principles

1. **Agents do the work**
2. **User sets goals, budgets, and constraints**
3. **Most work is asynchronous**
4. **Code is hidden by default**
5. **Time, effort, and uncertainty are visible**
6. **UI represents reality, not tradition**

---

## 3. High-Level Architecture

### Layers

1. **Cognition Layer**

   * External systems (e.g. Claude Code)
   * Responsible for:

     * coding
     * testing
     * searching
     * summarizing
     * experimenting

2. **Control Layer** (core product)

   * Agent goals
   * Thinking budgets
   * Retry / escalation logic
   * Memory boundaries
   * Organization structure

3. **Representation Layer**

   * Pixel-art isometric world
   * Agents, rooms, movement, alerts
   * Visual state mirrors real system state

---

## 4. Fundamental Objects

### 4.1 Agent

An agent represents a specialized worker.

**Each agent has:**

* Goal
* Specialty
* Weaknesses
* Thinking budget
* Current task
* Confidence estimate
* Failure patterns

**Agents are intentionally imperfect.**

---

### 4.2 Thinking Budget

Budgets represent **attention and effort**, not cost.

User-facing controls:

* Speed vs depth
* Exploration level
* Skepticism level

Under the hood:

* Token limits
* Retry counts
* Self-critique loops
* Parallel attempts

---

### 4.3 Task (Field)

A task is a **living process**, not a checklist item.

**Task state includes:**

* Intent
* Assigned agents
* Growth stage (seeded → exploring → stabilizing → harvestable)
* Open questions
* Time spent thinking
* Suggested intervention (if any)

---

### 4.4 Organization

A structured group of agents working toward a shared goal.

**Defines:**

* Reporting structure
* Escalation paths
* Shared memory
* Agent roles

Examples:

* Startup
* Research lab
* Maintenance team

---

## 5. Agent Types (Initial)

### Builder

* Uses Claude Code
* Writes and tests code
* Slow, deliberate

### Researcher

* Searches papers, blogs, docs
* Summarizes and proposes directions

### Scout

* Monitors Twitter/X, tools, trends
* Surfaces relevant signals

### Reviewer

* Challenges assumptions
* Identifies risks and alternatives

### HR Agent

* Observes system usage
* Suggests new agent types
* Recommends org changes

---

## 6. UI Concept (Pixel Art)

The UI is a **place**, not a dashboard.

![Image](https://images.openai.com/static-rsc-3/hF2ZUFTyszli0dCaHQMcYtQgSzy0dPakLXDrsiT_br3j6l3WS4h1MSLL70a5pkDJJmi5ILRiSvqQ1F884X258PLt-kgIj2saJWQf82qZYK0?purpose=fullsize\&v=1)

![Image](https://cdn.gamedevmarket.net/cover-images/svyKxJ5jZzL3xWyIUyKVOrqhc9G51gkRL7f2n11A.png)

![Image](https://p7.hiclipart.com/preview/989/481/146/siege-of-avalon-isometric-graphics-in-video-games-and-pixel-art-turn-based-strategy-others.jpg)

![Image](https://i.imgur.com/fVUD3Le.png)

---

## 7. Spatial Semantics (UI → Meaning Mapping)

| Visual Element         | Meaning                   |
| ---------------------- | ------------------------- |
| Agent sitting          | Active thinking           |
| Agent walking          | Task transition           |
| Agent pacing           | Uncertainty / exploration |
| Agents grouped         | Collaboration             |
| Empty room             | Idle capacity             |
| Alert icon             | Escalation needed         |
| Agent approaching user | Needs intervention        |

**No animation without semantic meaning.**

---

## 8. Rooms (Initial)

### Research Room

* Exploration
* Reading
* Idea generation

### Workshop

* Implementation
* Experiments
* Builds

### Review Room

* Critique
* Risk assessment
* Validation

### Observatory

* External monitoring
* Trends and signals

### Office (User)

* Decision-making
* Interventions
* Hiring

---

## 9. Debugging Model

Debugging is **interrogation**, not inspection.

Flow:

1. Agent signals a problem
2. User asks:

   * Why this approach?
   * What alternatives failed?
   * What assumption is weakest?
3. Only then:

   * Relevant code
   * Diffs
   * Test output

Code is a **diagnostic artifact**, not a workspace.

---

## 10. Hiring Flow

1. Need emerges (explicit or inferred)
2. HR agent suggests agent archetypes
3. User reviews:

   * Strengths
   * Weaknesses
   * Thinking cost
4. User hires

Hiring increases:

* capability
* management overhead
* system complexity

Growth has weight.

---

## 11. Default User Loop

1. Observe system state
2. Allocate / adjust budgets
3. Occasionally intervene
4. Wait
5. Harvest outcomes
6. Reflect

**Waiting is a first-class state.**

---

## 12. MVP Scope (Strict)

### Included

* Single isometric office
* Max 5 agents
* 4–5 agent types
* One organization
* Thinking budget controls
* Claude Code integration
* No freeform building

### Excluded

* Custom maps
* Multi-org switching
* Fine-grained code editing
* Heavy customization
* Multi-model orchestration (v1)

---

## 13. Non-Goals

This system is **not**:

* an IDE
* a task manager
* a chat interface
* a coding assistant
* a productivity tracker

---

## 14. Design Test (Litmus Test)

If the user:

* types constantly → failure
* stares at code → failure
* feels rushed → failure
* feels like a manager → success
* feels comfortable waiting → success

---

## 15. Summary

This product:

* acknowledges reality
* removes performative coding
* makes thinking visible
* treats AI as labor
* treats the user as steward

It is an **operating system for cognition**, not software development.

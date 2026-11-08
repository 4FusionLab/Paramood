# Paramood — Master Prompt for Codex

English | [Русский](REQUIREMENTS.ru.md)

> This document preserves the original master prompt and subsequent clarifications. Historical instructions and planned features are not proof of current behavior; where they conflict with later clarifications or current project rules, those take precedence. See the [README](../README.md) and [user guide](USER_GUIDE.md) for current behavior and limitations.

> Current user decision from November 5: Quick Parameters and Quick Calculator are combined into one Paramood palette with a common field. The expression without `=` is evaluated, the input with assignment is sent to the parameter preview; the application of the changes remains explicit. The references to individual palettes below describe the previous edition of the requirements. Cleanup remains a separate palette.

> User clarification from November 5 about the scope of changes: Paramood works with the parameters of the current model and should allow changing user parameters that control its geometry; rebuilding the geometry of the current model is the expected result. Paramood does not edit the parameters of added externally related parts. This is a requirement for target functionality and not an endorsement of the current implementation: the current limitations and test results are described in [README](../README.md). Before you enable changes, you must ensure that rebuilds and rollbacks are performed correctly in Fusion; When there is uncertainty, safe failure is maintained.

> User clarification from November 5th about the result of the rebuild: If changing a parameter results in an operation error in the Fusion history, this is a valid result, as if changing the parameter manually. A warning or operation error in itself should not undo the change. Application errors, incomplete batch execution, and an outdated document or preview still require a safe failure or rollback of the transaction.

## 0. Your role: Lead Architect & Multi-Agent Orchestrator

You are the main agent-orchestrator of the **Paramood** project.

Paramood is an Add-In for Autodesk Fusion designed to quickly manage model parameters, evaluate expressions, and safely clear unused parameters.

Your task is not only to design and implement the product, but also to **organize the development through several specialized subsidiary agents**.

You act simultaneously as:

- Technical Lead.
- Solution Architect.
- Product Engineer.
- Engineering Manager.
- Code Reviewer.
- Integration Owner.

**You are responsible for the final result, architectural integrity and performance of the product.**

Don't limit yourself to making a plan. Organize tasks, delegate them, integrate results and bring the project to working condition.

---

# 1. Multi-Agent Orchestration

## 1.1. Operating principle

The main chat acts as an orchestrator.

He does not have to do all the development sequentially himself if delegation is available.

Use the mechanisms available in the current environment:

- Subagents.
- Child agent sessions.
- Parallel work processes.
- Git worktrees.
- Other supported delegation mechanisms.

If the platform supports the creation of separate chats or child sessions, use them.

If creating self-hosted chats is not supported, use available agent tools. Do not simulate agent creation via text messages or claim that work has been delegated unless the corresponding process is actually running.

## 1.2. Create the following roles

### Agent 1 — Fusion API Researcher

Area of ​​responsibility:

- Studying the current Autodesk Fusion API.
- Checking all planned methods.
- Study of the Palette API.
- Command API research.
- Studying UserParameters and ModelParameters.
- UnitsManager research.
- Fusion event research.
- Checking Undo and transactional capabilities.
- Checking algorithms for determining unused parameters.
- Exploring API limitations on macOS.

Result:

`docs/FUSION_API_RESEARCH.md`

The document should contain confirmed APIs, links to official documentation, restrictions and recommendations for implementation.

Don't allow fictitious API methods.

### Agent 2 — Python Core Engineer

Area of ​​responsibility:

- Parameter Service.
- Expression Parser.
- Expression Engine.
- Units Service.
- Dependency Analyzer.
- Validation.
- Batch creation and updating of parameters.
- Safely clear parameters.
- Unit tests.

Domain logic should be separated from `adsk` as much as possible so that it can be tested without Fusion running.

### Agent 3 — Frontend & UX Engineer

Area of ​​responsibility:

- Preact / TypeScript.
- UI Kit.
- Quick Parameters.
- Quick Calculator.
- IntelliSense.
- CodeMirror 6.
- Syntax highlighting.
- Auto completion.
- Preview.
- Parameter Cleanup interface.
- Adaptive layout.
- Light and dark themes.
- Keyboard-first UX.

The interface must be high-quality, compact and visually compatible with Autodesk Fusion.

### Agent 4 — Fusion Integration Engineer

Area of ​​responsibility:

- Fusion Add-In structure.
- Manifest.
- Command registration.
- Creation of Palette.
- HTML ↔ Python Bridge.
- Synchronization of the active document.
- Working with Fusion events.
- Add-In life cycle.
- Installation and launch on macOS.
- Integration scenarios.

### Agent 5 — QA & Code Reviewer

Area of ​​responsibility:

- Requirements analysis.
- Architecture verification.
- Unit tests.
- Contract tests.
- Integration scenarios.
- Edge cases.
- Security check for deletion.
- Checking calculations and dimensions.
- Code Review.
- Checking the completeness of the implementation.
- Search for discrepancies between technical specifications and implementation.

This agent must act as an independent critic of the decisions of other agents.

## 1.3. Orchestration Rules

1. First, create a general architecture and a list of tasks.
2. Start API research as early as possible.
3. Define contracts between Backend, Frontend and Integration.
4. Delegate independent tasks in parallel.
5. Assign each agent a specific result and readiness criteria.
6. Minimize parallel editing of the same files.
7. Use separate branches or worktrees if they are available and appropriate.
8. Regularly collect results and check compatibility.
9. After each significant stage, run tests and reviews.
10. If the agent has detected a critical blocker, redistribute tasks.
11. Do not accept code without verification.
12. Avoid architectural divergence between agents.

The orchestrator must remain an active leader of the process, rather than simply assign tasks and stop participating.

## 1.4. Orchestrator reporting format

Keep the following historical status file up to date:

`docs/PROJECT_STATUS.md`

This file is not present in the current repository; consult the [README](../README.md) for current status.

It should reflect:

- Current stage.
- Active tasks.
- Responsible agents.
- Completed tasks.
- Blockers.
- Architectural solutions.
- Test results.
- Next steps.

In the chat, show compact reports on completed stages. Don't clutter the main chat with intermediate details of agents' work.

Do not pass off planned but not yet completed tasks as completed.

---

# 2. Product description

**Name: Paramood**

Category: Autodesk Fusion Add-In.

Target platform: Autodesk Fusion on macOS.

The main goal is to simplify and speed up everyday work with parametric models.

## Function modules

1. Quick Parameters - quickly create and change parameters.
2. Quick Calculator - calculation of expressions with support for model parameters.
3. IntelliSense - intelligent auto-completion of parameters, functions and units.
4. Parameter Cleanup - securely clear unused user parameters.

Quick Parameters and Quick Calculator are located in a constantly accessible panel.

Parameter Cleanup is launched as a separate command.

In the list of named parameters, you can sort by name or value, switch direction, and bulk expand and collapse groups. The groups are initially collapsed. Favorites are displayed separately and are synchronized with the standard Fusion favorites.

---

# 3. Technology stack

## Backend

- Python 3.
- Autodesk Fusion API.
- `adsk.core`.
- `adsk.fusion`.

## Frontend

- TypeScript.
- Preact.
- Vite.
- CodeMirror 6.
- Lucide Icons.
- CSS with support for Fusion themes.

## Quality

- Python type hints.
- TypeScript strict mode.
- Pytest.
- Vitest.
- Ruff.
- ESLint.
- Prettier.

Do not include heavy dependencies without justification.

Keep your Python code compatible with the version of Python actually shipped with the supported version of Fusion.

The entire user interface must be in English with the architectural possibility of subsequent localization.

Historical instruction: maintain project documentation and work reports in Russian. This is superseded by the current project rule: documentation is maintained in English with a separate Russian version; plans and discussion are in Russian.

---

# 4. Architecture

Divide the project into the following layers:

### Fusion Adapter

Isolates direct interaction with the Autodesk Fusion API.

### Parameter Service

Controls the retrieval, creation, updating, and deletion of parameters.

### Expression Engine

Parses expressions, builds dependencies, checks syntax and dimensions.

### Units Service

Controls units of measurement and conversions.

### Dependency Analyzer

Builds a graph of parameter dependencies and identifies candidates for deletion.

### Bridge

Provides asynchronous interaction between Python and HTML UI.

### Frontend

Displays state, processes user input, and interacts with Backend via Bridge.

## Mandatory architectural requirements

- Fusion API is the only source of truth about model parameters.
- Domain logic does not depend on the UI.
- The UI does not contain a direct implementation of the Fusion API.
- Data exchange via a typed JSON protocol.
- Each asynchronous message has a request ID.
- All errors have a structured format.
- Protection against outdated answers is provided.
- Model modification operations are performed in the correct Fusion context.
- API calls from inappropriate threads are prohibited.
- The state of the active document must be synchronized.

---

# 5. Permanent Paramood palette

Create an HTML Palette available during modeling.

## Location

The desired location is the lower left side of the Fusion interface, near the standard Comments area.

Use only officially supported Fusion mechanisms.

Check the docking and placement options for the Palette.

If it is not possible to fit into the desired region, implement the closest supported location. Don't try to change Autodesk's internal UI.

## Behavior

- Automatic opening when the addon is launched.
- Possibility of closing and reopening.
- Compact mode.
- Collapse of blocks.
- Saving dimensions and position, if available.
- Update when switching documents.
- Correct state when there is no active model.
- Support for light and dark themes.
- No unnecessary modal windows.

Approximate panel width: 340–380 px.

It should remain comfortable while being small.

## Layout

Top:

`Paramood` + compact panel controls.

First block:

`Quick Parameters`

Second block:

`Quick Calculator`

Don't turn your dashboard into a multi-page application.

Basic actions should be available immediately.

---

# 6. Quick Parameters

## Purpose

Quickly create or change multiple custom parameters with a single expression.

### Basic example

The user enters:

`w=15;h=10;l=h/2`

The model creates:

- `w = 15 mm`
- `h = 10 mm`
- `l = h/2`

Provided that the unit of project length is millimeters.

The result of `l` is equal to `5 mm`, but the formula `h/2` must be saved in Fusion.

## Supported expressions

```text
w=15
h=10
l=h/2
wall=2.4mm
count=5n
angle=45deg
inner=w-2*wall
ratio=w/h
```

It is possible to pass multiple definitions via `;`.

Support spaces and line breaks.

## Unit rules

1. An independent numeric value without a unit, such as `w=15`, gets the length unit of the active project.
2. The suffix `n` means a dimensionless value, for example `count=5n`.
3. Explicit units take precedence.
4. Expressions store references to parameters.
5. Numerical coefficients inside formulas remain dimensionless, for example `h/2`.
6. The result of dividing two lengths can be dimensionless.
7. An explicit angular value must preserve angular dimension.
8. Incorrect operations with dimensions are prohibited.
9. The `n` suffix is ​​Paramood syntax, not Fusion.

Introduce strict and documented rules for determining the dimensionality of expressions.

If the dimension cannot be determined reliably, show an error instead of an unsafe assumption.

## Creating parameters

Use `UserParameters.add()` and the corresponding APIs.

Do not substitute the calculated number in place of the parametric formula.

## Changing existing settings

If the parameter exists, update its expression.

For example, input:

`w=20`

Should show in Preview:

`w: 15 mm → 20 mm`

The user must understand that a change is being made.

Don't allow the dimension of an existing parameter to change unnoticed.

## Preview

Show a list of future changes under the editor.

For each element:

- Name.
- Expression.
- Calculated value.
- Unit of measurement.
- Status.

Statuses:

- New.
- Update.
- Error.
- Warning.

Preview is recalculated during editing, but should not permanently change the actual model.

## Batch processing

Before saving:

1. Parse all user input.
2. Build AST.
3. Identify dependencies.
4. Check circular links.
5. Perform topological sorting of creation operations.
6. Check the correctness of expressions and units.
7. Check for conflicts with existing parameters.
8. Prepare a change plan.
9. Make changes via Fusion API.
10. Handle errors and ensure the highest possible atomicity.

Explore the official features of Fusion Undo and command transactions.

Don't create a false guarantee of atomicity. If a full rollback is not possible, provide safe compensation for changes and explicitly document the restrictions.

## Management

- `Enter` — apply changes.
- `Shift+Enter` — line break.
- `Tab` - accept IntelliSense prompt.
- `Esc` — close hints.
- `Ctrl+Space` - open IntelliSense.

When IntelliSense is open, Enter accepts the selected prompt and does not apply the entire batch.

After a successful operation, show unobtrusive confirmation.

---

# 7. IntelliSense

**Full IntelliSense is required and must work in both Paramood editors.**

Use the generic implementation on CodeMirror 6.

Don't create two independent autocompletion mechanisms.

## Autocompletion of parameters

When entering:

`l=hei`

Offer existing parameters, for example:

- `height`
- `heightInner`

For each clue, show:

- Name.
- Current value.
- Unit of measurement.
- The original formula.
- Description, if available.

When selecting, substitute the name of the parameter, not the calculated value.

### Virtual hierarchy of parameters

The name `box_inner_size` is available as `box.inner.size` both in expressions and to the left of `=` when creating or changing a parameter; `box_inner_size` is transferred to Fusion. At each level, objects are suggested first, and the usual flat names are still available. Virtual paths are supported for model parameters and declarations of the current batch; names with empty segments are only available in regular notation. Values ​​and formulas remain tied to real parameters.

### Relative update and self-referencing

When first declaring a new parameter, IntelliSense does not provide its own name. When updating an existing or previously declared parameter in a batch, its name and `this` indicate the previous formula: before checking dependencies, it is substituted in parentheses so that Fusion saves the formula without self-referencing and does not lose dependencies. Operators `+=`, `-=`, `*=`, `/=` are available for model parameters and for parameters declared earlier in the current batch. Successive changes are converted to a single formula from the previous expression and the right-hand operand. For `+=` and `-=`, a number without a unit is interpreted in the unit of the updated parameter; for `*=` and `/=` - as dimensionless. Division by zero and incompatible dimensions are rejected. The parameter snapshot is rechecked before being written.

### Search

Support:

- Prefix matching.
- Case-insensitive matching.
- Fuzzy matching.
- Ranking of results.
- Highlighting matches.

Give priority to exact and prefix matches.

## Contextual behavior

IntelliSense needs to understand where the cursor is in the expression.

In Quick Parameters:

- To the left of `=` the user enters the name of the new parameter.
- To the right of `=` the user enters the formula.

Suggest parameters and virtual objects in formulas and when entering a name to the left of `=`. On the left, don't offer functions and units.

Also suggest parameters that are declared in the current input but not yet created in Fusion.

For example:

`w=15;h=w/2`

When you enter the formula `h`, the parameter `w` should already be available in IntelliSense.

## Function completion

Support mathematical functions that are actually available in the expression engine you are using:

- `sqrt()`
- `sin()`
- `cos()`
- `tan()`
- `abs()`
- `floor()`
- `ceil()`
- `round()`
- `min()`
- `max()`

The list and syntax of functions must conform to the supported Fusion documentation.

When selecting a function:

1. Insert a name.
2. Add parentheses.
3. Place the cursor inside the brackets.

Show a description of the function and an example of use.

## Unit completion

Maintain units of length, angle, and other units applicable to the expression.

For example:

`mm`, `cm`, `m`, `in`, `deg`, `rad`.

The list must be formed taking into account the units supported by Fusion and the context of the expression.

## Syntax highlighting

Different categories of tokens should have a distinguishable design:

- Existing parameters.
- New parameters.
- Mathematical functions.
- Numbers.
- Units.
- Operators.
- Errors.

Unknown parameters should be highlighted.

When you hover over a recognized parameter, show a tooltip with details.

## Keyboard navigation

- ArrowUp / ArrowDown - move according to prompts.
- Tab - select.
- Enter - select.
- Esc - close.
- Ctrl+Space - open manually.

Maintain the cursor position when pasting.

Support autocompletion in any part of the line.

## Performance

Don't call the Fusion API every time you press a key.

Use a local parameter cache and synchronization mechanism.

Provide asynchronous updating and protection against outdated results.

Popup tooltips should fit correctly inside a small Palette.

---

# 8. Quick Calculator

## Purpose

A mathematical calculator that understands existing Fusion model parameters.

Examples:

```text
sqrt(25)
15*3
sin(45deg)
h-w/2
sqrt(w*w+h*h)
```

## Behavior

- Calculate the result as you type.
- Don't require a separate Calculate button.
- Recognize existing parameters.
- Use their current values.
- Take dimensions into account.
- Support mathematical functions.
- Display errors directly in the interface.
- Use shared IntelliSense.
- Support syntax highlighting.

Ordinary numeric literals in the calculator are dimensionless.

For example:

`sqrt(25) = 5`

Whereas:

`h-w/2`

Returns a dimension result if `h` and `w` are lengths.

## Compute engine

Do not use unsafe `eval()`.

Choose your own AST parser with validation and secure computation, or a validated Fusion API engine suitable for these tasks.

Correctly account for Fusion's internal units of measurement.

The result should be displayed in units understandable to the user.

## Copy

The user can copy:

- Just a number.
- The value along with the unit.
- Original expression.

The main copying action should be done with one click.

If necessary, use the Python Bridge if the Clipboard API of the built-in browser is limited.

## Creating a parameter from the result

Add an action:

`Save as Parameter`

It allows you to specify a name and create a custom parameter.

By default, save the mathematical formula rather than just the calculated value if the expression is valid for Fusion parameters.

## History

Keep the last 20 calculations.

The history opens as a separate compact element and does not occupy the main space of the panel.

---

# 9. Parameter Cleanup

Create a separate command:

**Clean Unused Parameters**

It should be accessible through the Fusion interface.

Use the HTML interface in Command Dialog via a verified API. If BrowserCommandInput is missing or inappropriate in the target version of Fusion, select an officially supported alternative and record your decision.

## Dependency analysis

Explore:

- `design.userParameters`
- `design.allParameters`
- `dependencyParameters`
- `dependentParameters`
- `isDeletable`
- connections between ModelParameters and model operations.

Don't rely only on direct dependencies.

Construct a graph for using parameters.

### Example

```text
tempWidth = 100 mm
tempHalf = tempWidth/2
```

If these parameters are not used by geometry and other persisted parameters, they may be candidates for deletion.

If `tempHalf` is used by another parameter that is involved in building the model, the entire chain must be preserved.

## Safety principles

- Analyze transitive dependencies.
- Protect parameters used by the model.
- Do not delete parameters if the analysis result is uncertain.
- Consider the possibility of external dependencies that the Fusion API does not expose.
- Protect Favorites by default.
- Check `isDeletable`.
- Recheck before deleting.

## Interface

Show a list of candidates with checkboxes.

Columns:

- Checkbox.
- Parameter.
- Expression.
- Value.
- Unit.
- Favorite.
- Reason.

Add:

- Search.
- Select All.
- Deselect All.
- Number of selected.
- Protect favorite parameters.
- Confirmation of deletion.

By default, safe candidates are selected automatically.

The user can uncheck any option.

If the user left the parameter, all the dependencies required for it should also be preserved, even if they were previously candidates for removal.

## Delete

Before deleting:

1. Get the current state of the model.
2. Rebuild dependencies.
3. Check the selected set.
4. Determine a safe removal procedure.
5. Perform deletion.
6. Handle errors.
7. Provide an Undo or documented recovery strategy.

No automatic deletion without confirmation.

---

# 10. UI/UX Design System

Paramood should feel like it's part of Autodesk Fusion.

## Principles

- Compact.
- Keyboard-first.
- Context-aware.
- Immediate feedback.
- Safe by default.
- Minimal visual noise.
- Progressive disclosure.

## Visual style

Use:

- Neutral surfaces.
- Compact input fields.
- Clear visual hierarchy.
- Moderate rounding radii.
- Minimum decorative effects.
- Neat icons.
- Unobtrusive statuses.
- Good readability.

Support light and dark themes.

## Components

Create reusable ones:

- Input.
- ExpressionEditor.
- IntelliSensePopup.
- ParameterSuggestion.
- Tooltip.
- StatusIndicator.
- PreviewRow.
- ErrorMessage.
- CopyButton.
- IconButton.
- CollapsibleSection.
- ParameterTable.
- ConfirmDialog.

Don't create separate, duplicate component implementations for different modules.

## UX states

Consider:

- Empty.
- Loading.
- Editing.
- Valid.
- Invalid.
- Success.
- Warning.
- Disabled.

All user input errors should be clear, specific, and shown next to the problematic expression.

---

# 11. Fusion Integration

The addon should:

- Launch via Scripts and Add-Ins.
- Register its commands correctly.
- Create a Palette.
- Stop correctly.
- Delete created UI elements if necessary.
- Release event handlers.
- Do not create duplicates after restart.
- Work with the active document.
- React to document switching.
- Process document closure.
- Do not use data from the previous model.
- Work correctly without open Design.

Learn Fusion's event model.

Use supported mechanisms for accessing the Fusion API from HTML interface message handlers.

If the processing of an operation must be transferred to a special command or event context, implement this correctly.

---

# 12. Project structure

Approximate structure:

```text
Paramood/
├── Paramood/
│   ├── Paramood.py
│   ├── Paramood.manifest
│   ├── core/
│   │   ├── parameters.py
│   │   ├── expressions.py
│   │   ├── dependencies.py
│   │   ├── units.py
│   │   └── models.py
│   ├── fusion/
│   │   ├── adapter.py
│   │   ├── events.py
│   │   └── lifecycle.py
│   ├── commands/
│   │   └── cleanup.py
│   ├── bridge/
│   │   ├── protocol.py
│   │   └── handlers.py
│   ├── ui/
│   │   └── palette.py
│   └── resources/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── features/
│   │   │   ├── quick-parameters/
│   │   │   ├── calculator/
│   │   │   ├── intellisense/
│   │   │   └── cleanup/
│   │   ├── bridge/
│   │   ├── hooks/
│   │   ├── styles/
│   │   └── app.tsx
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── frontend/
├── scripts/
├── docs/
│   ├── FUSION_API_RESEARCH.md
│   ├── PROJECT_STATUS.md
│   └── TEST_PLAN.md
├── README.md
├── ARCHITECTURE.md
├── AGENTS.md
└── .gitignore
```

You can improve the structure if it is justified.

Don't complicate it unnecessarily.

---

# 13. Testing

Develop automated tests for domain logic.

## Expression Engine

Check:

- Simple values.
- Formulas.
- Explicit units.
- Default project units.
- Suffix `n`.
- Links to existing parameters.
- Links to the parameters of the current batch.
- Cyclic dependencies.
- Mathematical functions.
- Incompatible dimensions.
- Unknown parameters.
- Incorrect syntax.

## Parameter Service

Check:

- Creation.
- Change.
- Name conflicts.
- Creation order.
- Error handling.
- Batch operations.
- Recovery strategy.

## Dependency Analyzer

Check:

- Independent parameters.
- Direct dependencies.
- Transitive dependencies.
- Unused chains.
- Chains used.
- Protection of Favorites.
- Unchecking by the user.
- Re-check before deleting.
- Safe removal procedure.

## Frontend

Check:

- Preview.
- IntelliSense.
- Keyboard navigation.
- Substitution of parameters.
- Syntax highlighting.
- Error handling.
- Copying.
- Switching documents.

For Fusion-dependent operations, prepare separate integration tests and manual verification scripts.

Don't claim to have passed checks inside Fusion if they weren't actually run in the running application.

---

# 14. Documentation

Create:

### README.md

- Purpose.
- Features.
- System requirements.
- Installation.
- Build.
- Launch.
- Examples.
- Known limitations.

### ARCHITECTURE.md

- General architecture.
- Components.
- Contracts.
- Bridge.
- Error handling.
- Working with parameters.
- Fusion Events.

### AGENTS.md

- Development rules.
- Sharing of responsibilities.
- Code style.
- Testing requirements.
- Rules for working with the API.
- Integration procedure.
- Ban on fictitious APIs.
- Requirements for review.

### PROJECT_STATUS.md

- Implementation status.
- Current tasks.
- Responsible agents.
- Completed work.
- Problems.
- Next steps.

---

# 15. Implementation order

## Phase 1 — Discovery & Architecture

Orchestrator:

1. Creates or launches available child agents.
2. Delegates research to Fusion API.
3. At the same time, defines the architecture and contracts.
4. Forms a general backlog.
5. Defines limitations.
6. Fixes decisions in documentation.

Don't block all independent work while exploring the API. But don't implement unverified API calls until a researcher has verified them.

## Phase 2 — Project Bootstrap

The following are executed in parallel:

- Creation of Fusion Add-In.
- Python initialization.
- Preact/TypeScript/Vite initialization.
- Setting up linters.
- Setting up testing.
- Creation of JSON Bridge.
- Build setup.

The orchestrator integrates the result.

## Phase 3 — Working Vertical Slice

Implement a minimal full-fledged scenario:

1. Fusion launches Paramood.
2. Palette appears.
3. The active model is determined.
4. Existing parameters are loaded.
5. Model units are displayed.
6. The user creates one parameter.
7. The user performs the calculation.
8. UI receives real Fusion response.
9. When you switch the document, the status is updated.

The real integration must be used, not mock data.

## Phase 4 — Core Functionality

Parallel implementation:

- Quick Parameters.
- Expression Engine.
- Units Service.
- IntelliSense.
- Quick Calculator.
- Parameter Cleanup.

Before parallel work, agree on the interfaces of the modules.

## Phase 5 — Integration & Hardening

Orchestrator:

1. Integrates results.
2. Checks compatibility.
3. Runs tests.
4. Transfers the code to the QA agent.
5. Corrects detected problems.
6. Checks the build.
7. Prepares installation instructions.
8. Checks the result against the acceptance criteria.

---

# 16. Definition of Done

Paramood is considered ready for the first full version when:

- The addon is installed and launched in Fusion.
- Permanent Palette works.
- You can enter `w=15;h=10;l=h/2`.
- Parameters are created with the correct units.
- Formulas preserve dependencies.
- `count=5n` creates a dimensionless value.
- Existing settings can be updated.
- Preview shows the result before saving.
- IntelliSense suggests existing parameters.
- IntelliSense suggests parameters for the current batch.
- IntelliSense offers math functions.
- Keyboard navigation works.
- The calculator understands Fusion parameters.
- Calculator results can be copied.
- Safe clearing of unused parameters works.
- The user selects parameters to delete through checkboxes.
- Used parameters are protected.
- The interface works correctly when switching documents.
- Light and dark themes are supported.
- Automated tests pass.
- The documentation is up to date.
- Known limitations are clearly stated.

Don't declare a project ready just because its files are created.

---

# 17. Priorities

If there are conflicting requirements, use the following order:

1. Integrity and safety of the Fusion model.
2. Correctness of calculations and dimensions.
3. Compliance with the official Autodesk API.
4. Performance of the main scenarios.
5. UX quality.
6. Productivity.
7. Architectural extensibility.
8. Visual polishing.

Don't sacrifice correctness for quick completion.

---

# 18. Instructions for starting

**Start execution right now.**

Your first work cycle:

1. Explore the current project directory and available tools.
2. Check the possibilities of creating child agents.
3. Form a team and share responsibility.
4. Create child tasks or sessions if the environment supports it.
5. Delegate research to Autodesk Fusion API.
6. Delegate frontend and backend architecture.
7. Define uniform interaction contracts.
8. Initialize the Paramood repository.
9. Set up the build and testing.
10. Start implementing a working vertical slice.

**Don't stop after researching or planning.**

Make standard technical decisions yourself if they do not contradict the technical specifications.

If there is an API limitation, find a valid alternative, document the solution, and move on.

Constantly monitor the overall result, integrate changes and check quality.

Do not use fictitious test results, fictitious child agents, or unverified Fusion API methods.

The main chat should remain the orchestrator throughout the project.

**Goal: to get a real, high-quality implemented and expandable Autodesk Fusion Add-In Paramood, and not a set of disparate files.**

## Variants 2.0 — clarification of 8 November 2026

- Do not use Autodesk's Configuration API; implement the agreed workflows independently.
- Choose one model-wide set of parameters and supported timeline features, never per-row sets.
- At every width: variants are rows and parameters/features are columns. Do not transpose.
- Drag-and-drop reorders both axes; their stored orders are independent of orientation.
- Headings remain horizontal with word wrapping; horizontal scrolling starts only when the
  value columns cannot fit readably. Do not include a Go to control.
- Click a value to edit its expression. Feature checked means Enabled; unchecked means Suppressed.
- All table edits are a draft until Save. Cancellation never changes the model; confirm discarding.
- Save validates the whole table, applies only the changed active variant and stores all rows.
  Free applies none. Preserve the header's existing switching interaction.
- Editing an outside-set parameter is global and never enrolls it. Mark controlled parameters in
  the common list with a table icon and the tooltip Controlled by variants.
- Use only variants.v2. Older records are neither read nor migrated nor deleted.
- Release 2.0.0 only after the owner's personal review and explicit authorization. A review build
  is not a release.
- Contracts, API sources, evidence and limits: [Variants 2.0](VARIANTS_V2.md).

## Model units and Hybrid view — 7 November 2026

- Length units appear next to the model name and can be changed with a dropdown (`mm`, `cm`, `m`, `in`, `ft`) through `FusionUnitsManager.distanceDisplayUnits`. The setting changes the current Design while preserving physical parameter values. A stale snapshot is rejected.
- A third, Hybrid view is added and selected by default. Its base is the parameter list; the shared calculation and parameter-creation field is fixed at the bottom. Calculation results, history and assignment previews appear in a closable panel above the field and list.
- Calculator and the list are available through separate controls. Switching does not lose the shared input.

## Text parameters — 7 November 2026

Single- and double-quoted literals automatically create text parameters without a separate type selector. TextValue is used for display; editing and writing use the original expression, including references and formulas. Quoted contents and escaping are preserved exactly; incompatible changes to an existing parameter's type are rejected before writing. Text parameters do not by themselves block numeric changes in a mixed model, but graph completeness and consistency are still checked. Text parameters are included in saved variants and travel with F3D. See [Text parameters](TEXT_PARAMETERS.md).

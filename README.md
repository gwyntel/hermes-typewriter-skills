[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/gwyntel/hermes-typewriter-skills)

# Hermes Typewriter

A minimalist, e-ink optimized chat interface for [hermes-agent](https://github.com/NousResearch/hermes-agent).

This application is specifically designed to run on **Amazon Kindle** e-ink browsers, adhering to strict constraints for older WebKit and newer Chromium-based firmware.

## Key Features

- **Split-Mode Architecture**:
    - **Streaming Mode**: Fast, token-by-token feedback using Server-Sent Events (SSE). History is stored in `localStorage` but capped to prevent memory bloat.
    - **Responses Mode**: Minimal local storage footprint. Consistently pages long conversation history from the server using the Responses API (previous response ID chaining).
- **E-Ink Optimized UI**:
    - High-contrast, monochrome design (Paperwhite-friendly).
    - Animation-free interactions to prevent ghosting.
    - Large touch targets (minimum 48px).
    - System monospace typography for maximum compatibility.
- **SSE Internal Proxy**: A custom Python proxy (`server.py`) ensures SSE events are flushed line-by-line for smooth token rendering on low-power devices.
- **API-Driven Tunnel Discovery**: `serve.sh` uses programmatic API checks (Cloudflare Prometheus metrics or Ngrok's `/api/tunnels`) for near-instant tunnel URL reporting.
- **Session Continuity**: Named sessions (3-64 chars, alphanumeric, `-`, `_`) that sync with the backend's `state.db`.

## Quick Start

### For Hermes agents

Clone `https://github.com/gwyntel/hermes-typewriter-app`, install both skills below, then ask whether the user wants to run the **hermes-typewriter** workflow. That workflow configures the backend, starts the server, and establishes the Kindle chat frontend tunnel. Do not enable remote access or modify backend configuration without user authorization.

### Requirements

- `hermes-agent` installed and running.
- `python3` for the local proxy server.
- `cloudflared` (optional, for remote Kindle access).

### Configure backend

Ensure `~/.hermes/.env` has the API server enabled:

```dotenv
API_SERVER_ENABLED=true
API_SERVER_KEY=your-secret-key
```

### Start the application

Run the serve script to start the local server and establish a tunnel. Use `--install` to have the script install missing dependencies (`cloudflared` or `ngrok`) via the system package manager (`brew` on macOS, `apt` on Linux).

```bash
./serve.sh --install --port 8644
```

The script reports a `trycloudflare.com` or `ngrok.app` URL. Open it in your Kindle browser.

## Skills for Hermes Agent

This repository provides two Agent Skills-compatible skills:

- **`hermes-typewriter`**: Deploys the typewriter frontend, configures the Hermes backend API, and manages a Kindle access tunnel.
- **`kindle-web-development`**: Reference for developing frontend code under Kindle browser constraints.

### Install with Vercel Skills CLI

The canonical source is [gwyntel/hermes-typewriter-skills](https://github.com/gwyntel/hermes-typewriter-skills). Install either skill for Hermes Agent globally:

```bash
npx skills add gwyntel/hermes-typewriter-skills --skill hermes-typewriter --agent hermes-agent -g -y
npx skills add gwyntel/hermes-typewriter-skills --skill kindle-web-development --agent hermes-agent -g -y
```

To install both, run both commands. The CLI installs them into the selected agent's global skills location. Alternatively, install the complete companion application repository's copies by following its README; do not mix both sources into the same skill paths.

### Use and update

After installation, ask your Hermes agent to use `hermes-typewriter` to deploy the app or `kindle-web-development` before editing its frontend. Updating skills installed with the Vercel CLI:

```bash
npx skills update hermes-typewriter
npx skills update kindle-web-development
```

If your CLI version does not recognize a skill name, update from the source repository explicitly:

```bash
npx skills add gwyntel/hermes-typewriter-skills --skill hermes-typewriter --agent hermes-agent -g -y
npx skills add gwyntel/hermes-typewriter-skills --skill kindle-web-development --agent hermes-agent -g -y
```

This repository contains only skill definitions and their support files; the application itself is maintained in [hermes-typewriter-app](https://github.com/gwyntel/hermes-typewriter-app).

### Troubleshooting

- **Skill not discovered:** Confirm the installed folder contains `SKILL.md` with YAML frontmatter containing `name` and `description`; reinstall with the exact `--skill` name shown above.
- **Wrong target or path:** Pass `--agent hermes-agent` to select Hermes and `-g` for global installation. Check the CLI output for the actual destination and avoid installing duplicate copies through symlinks.
- **Permission errors:** Use a writable user-level global location; avoid `sudo` with `npx skills`. If a local install is needed, omit `-g` and install in the project directory.
- **Update fails:** Update the `skills` CLI (`npx skills --help` for supported commands), then rerun `npx skills add` using the canonical repository source.

## Agent-Led Customization

Since this project is designed for agents to maintain and evolve, you can use the following prompt to have an agent customize the application's look and feel.

### Customization prompt

> "I want to customize the Hermes Typewriter interface. Please act as a senior frontend engineer and product designer to help me define a new aesthetic direction.
>
> **Instructions:**
> 1. **Analyze Constraints**: Read `skills/kindle-web-development/SKILL.md` to understand the strict e-ink browser limitations (no animations, no flexbox `gap`, ES2019 limit, high-contrast only, no transparency).
> 2. **Propose Directions**: Suggest 3 distinct visual directions (e.g., **Brutally Minimal**, **Retro-Technical**, **Elegant Editorial**) that will render perfectly on a Kindle.
> 3. **Implement Design**: Once I choose a direction, update `style.css` (UI design tokens), `app.js` (UI labels/logic), and `config.js` (runtime settings).
> 4. **Refine Personality**: Update the `instructions` field in `config.js` to ensure the agent's tone matches the new visual persona.
> 5. **Final Polish**: Ensure all touch targets are at least 48px, typography is highly legible, and the layout remains 'solid' (avoiding ghosting artifacts)."

## Development

If you wish to modify the code:
- **`app.js`**: Main logic (streaming parser, state management).
- **`style.css`**: Design tokens and e-ink layout (no `gap`, no animations).
- **`server.py`**: Python HTTP proxy for auth and SSE flushing.

Refer to the `kindle-web-development` skill before making frontend changes to ensure they remain compatible with e-ink hardware.

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

### 🤖 For Hermes Agents (One-Click Setup)
If you are an agent or human installing with an agent, follow this prompt to set up the typewriter:
> "Clone the repository `https://github.com/gwyntel/hermes-typewriter-app`. Link both skills found in `skills/` to your home `~/.hermes/skills/` directory. Once installed, confirm your path and ask the user if they would like to proceed with the `hermes-typewriter` skill workflow to configure the backend, run the server, and establish the Kindle chat frontend tunnel over the public internet."

### 1. Requirements
- `hermes-agent` installed and running.
- `python3` for the local proxy server.
- `cloudflared` (optional, for remote Kindle access).

### 2. Configure Backend
Ensure your `~/.hermes/.env` has the API server enabled:
```bash
API_SERVER_ENABLED=true
API_SERVER_KEY=your-secret-key
```

### 3. Start the Application
Run the serve script to start the local server and establish a tunnel. Use the `--install` flag to have the script automatically install any missing dependencies (`cloudflared` or `ngrok`) via your system's package manager (`brew` on macOS, `apt` on Linux).

```bash
# Auto-detect + Auto-install if missing
./serve.sh --install --port 8644
```

The script will provide a `trycloudflare.com` or `ngrok.app` URL. Open this URL in your Kindle's browser.

## 🎨 Agent-Led Customization

Since this project is designed for agents to maintain and evolve, you can use the following prompt to have an agent (like Antigravity or a Hermes Agent) customize the application's look and feel for you.

### 🪄 Customization Prompt
Copy and paste this to your AI coding assistant:

> "I want to customize the Hermes Typewriter interface. Please act as a senior frontend engineer and product designer to help me define a new aesthetic direction. 
> 
> **Instructions:**
> 1. **Analyze Constraints**: Read `skills/kindle-web-development/SKILL.md` to understand the strict e-ink browser limitations (no animations, no flexbox `gap`, ES2019 limit, high-contrast only, no transparency).
> 2. **Propose Directions**: Suggest 3 distinct visual directions (e.g., **Brutally Minimal**, **Retro-Technical**, **Elegant Editorial**) that will render perfectly on a Kindle.
> 3. **Implement Design**: Once I choose a direction, update `style.css` (UI design tokens), `app.js` (UI labels/logic), and `config.js` (runtime settings).
> 4. **Refine Personality**: Update the `instructions` field in `config.js` to ensure the agent's tone matches the new visual persona.
> 5. **Final Polish**: Ensure all touch targets are at least 48px, typography is highly legible, and the layout remains 'solid' (avoiding ghosting artifacts)."

## Skills for Hermes Agent

This repository includes two specialized skills for `hermes-agent`:

1.  **`hermes-typewriter`**: Automates the deployment, backend configuration, and tunnel management for this application.
2.  **`kindle-web-development`**: A comprehensive reference for anyone wanting to modify the frontend. It documents every known constraint of the Kindle browser (ES2019 ceiling, flexbox bugs, memory limits, etc.).

### Installation
To use these skills with your agent, link them to the hermes skill directory:
```bash
ln -s $(pwd)/skills/hermes-typewriter ~/.hermes/skills/hermes-typewriter
ln -s $(pwd)/skills/kindle-web-development ~/.hermes/skills/kindle-web-development
```

## Development

If you wish to modify the code:
- **`app.js`**: Main logic (streaming parser, state management).
- **`style.css`**: Design tokens and e-ink layout (no `gap`, no animations).
- **`server.py`**: Python HTTP proxy for auth and SSE flushing.

Refer to the `kindle-web-development` skill before making any changes to ensure they remain compatible with e-ink hardware.

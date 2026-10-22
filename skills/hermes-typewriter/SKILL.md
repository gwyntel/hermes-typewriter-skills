---
name: hermes-typewriter
description: Serve the Hermes Typewriter frontend, establish a Cloudflare tunnel for Kindle access, and automatically configure the hermes-agent backend API.
version: 1.0.0
author: gwyntel
license: MutuaL-1.2
metadata:
  hermes:
    tags: [typewriter, kindle, e-ink, deployment, tunnel]
---

# Hermes Typewriter: Remote Kindle Access

Use this skill to deploy the typewriter frontend and ensure the hermes-agent backend is correctly configured for API access.

## Prerequisites

- `cloudflared` must be installed (or the skill will attempt to auto-download via `./serve.sh`)
- Repository: `https://github.com/gwyntel/hermes-typewriter-app`

## Workflow

Follow these phases to get the typewriter live on a Kindle:

### Phase 0: Setup & Update

1. **Clone or Update Repository**:
   - Check if the `hermes-typewriter-app` directory exists.
   - If not: `git clone https://github.com/gwyntel/hermes-typewriter-app`
   - If yes: `cd hermes-typewriter-app && git pull`
2. **Install Skills**:
   - Ensure the skill is linked to the agent's home:
     `ln -sf $(pwd)/skills/hermes-typewriter ~/.hermes/skills/hermes-typewriter`
     `ln -sf $(pwd)/skills/kindle-web-development ~/.hermes/skills/kindle-web-development`
3. **Install Session Context Hook**:
   - The hook injects recent session data into the typewriter frontend.
   - Create hooks directory if needed: `mkdir -p ~/.hermes/hooks`
   - Link the hook: `ln -sf $(pwd)/skills/hermes-typewriter/hooks/session-context ~/.hermes/hooks/session-context`
   - The hook writes session data to `~/.hermes/session_context.json` on `agent:start` events

### Phase 1: Backend Configuration

1. **Check API Health**: Before modifying any config, check if the API server is already running and accessible:
   - Try `curl -s http://localhost:8642/health`.
   - If it returns `{"status": "ok"}`, the backend is ready. Skip configuration and proceed to Phase 2.

2. **Retrieve API Key & Configuration**:
   - If the health check fails, read the current configuration from `~/.hermes/.env`.
   - Look for `API_SERVER_ENABLED` and `API_SERVER_KEY`.
   - If `API_SERVER_ENABLED` is missing or `false`, inform the user you will enable it.
   - If `API_SERVER_KEY` exists, take note of it. If not, inform the user they need to set an API key.

3. **Ensure Gateway is Running**:
   - Check if the gateway is running (`lsof -ti :8642`).
   - If not, start it in the background: `nohup hermes gateway > ~/.hermes/gateway.log 2>&1 &`
   - Re-verify with `curl http://localhost:8642/health`.

### Phase 2: Serve the Frontend

1. **Start the Proxy + Tunnel**:
   - Navigate to the `hermes-typewriter-app` directory.
   - Run the serve script **in the background**. The script will **auto-detect** if `cloudflared` or `ngrok` is available. Use `--install` to have it install missing software automatically (via `brew` on macOS or `apt` on Linux):
     ```bash
     # Auto-detect + Auto-install if missing
     nohup ./serve.sh --install > typewriter_serve.log 2>&1 &
     ```
   - *Note*: You can use `--port` if needed (default: 8644).

2. **Monitor the Log**:
   - Check `typewriter_serve.log` to find the tunnel URL (`.trycloudflare.com` or `.ngrok-free.app`).

### Phase 3: Reporting & Connection

1. **Inform the User**:
   - Provide the **Tunnel URL** clearly.
   - Instruct the user to navigate to this URL on their Kindle.
   - Remind them to check the `[CONNECTED]` status in the header.
   - Since the proxy handles the `Authorization` header, they should leave the API key blank in the browser settings UNLESS they change it.

### Phase 4: Verification

1. **Confirm Health**:
   - Use `curl -H "Authorization: Bearer <API_SERVER_KEY>" http://localhost:8642/v1/models` to verify the proxy is talking to the gateway.
   - If it returns JSON, the setup is successful.

## Reporting

When complete, provide a summary like:

> [!TIP]
> **Hermes Typewriter is Live!**
> 
> **Access URL**: `https://efforts-promised-rapids-jenny.trycloudflare.com`
> 
> **Instructions for Kindle**:
> 1. Open the Experimental Browser.
> 2. Go to the URL above.
> 3. Verify the `[CONNECTED]` status.
> 
> **Inference Status**: Online via Gateway (8642)

---

## Companion Skills

If you or the user would like to modify the frontend itself — adding new UI elements, adjusting the layout, changing the CSS design system, or extending JavaScript functionality — load the **`kindle-web-development`** skill first.

That skill contains an exhaustive, battle-tested reference for every browser constraint you will encounter: the ES2019 JavaScript ceiling, the flexbox `gap` bug, the animation ghosting problem, the 64 MB localStorage hard limit, touch target sizing, and much more. Any changes to `index.html`, `style.css`, or `app.js` **must** comply with those constraints or the Kindle browser will silently fail or crash.

```
skill: kindle-web-development
```

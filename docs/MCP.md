# MCP Server — use HeyVoices from Claude & other agents

`backend/heyvoice/mcp_server.py` exposes the running HeyVoices backend as
[Model Context Protocol](https://modelcontextprotocol.io) tools over **stdio**. Any MCP-capable
agent (Claude Desktop, Claude Code, Cursor, custom SDK agents) can then list your voices and
generate speech as a normal tool call. Everything stays on this machine — the MCP server is a thin
bridge to the local REST API on `127.0.0.1:17300`.

> The HeyVoices desktop app (or at least the Python backend) must be running. If the backend is
> down, tools return a clear "backend unreachable" error.

## Tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `list_voices` | — | All voices: `id`, `name`, `kind` (cloned/preset/designed), `language`, `engine`, `ref_clips` |
| `speak` | `text`, `voice` (name or id, optional), `engine`, `model` | Waits for the render: `file`, `path` (absolute), `url`, `duration`, `voice` |
| `start_generation` | `text`, `voice`, `language`, `model`, `output_format` | `{ "job_id": … }` — poll with `get_job` |
| `get_job` | `job_id` | `status` (queued/running/done/error), `progress`, `message`, `error`, `result` |
| `list_takes` | `limit` | Recent renders, newest first |
| `list_models` | — | Model catalog with download `state` per model |
| `studio_status` | — | Version, GPU/VRAM, loaded engines, active jobs |

Notes:
- `text` supports `[[pause:600]]` markers; on `chatterbox-turbo` also delivery tags like
  `[laugh]`, `[sigh]`, `[whisper]`.
- Omit `voice` in `speak` to use the first cloned voice; `engine`/`model` override the voice's
  default engine (e.g. `"model": "chatterbox-turbo"`, `"engine": "kokoro"`).
- `speak` blocks until the audio is ready (queue-aware, up to 10 min). Use
  `start_generation` + `get_job` for long texts.
- Override the backend URL with the `HEYVOICE_API` environment variable if you changed ports.

## Claude Desktop

Add to `%APPDATA%\Claude\claude_desktop_config.json` (paths: adjust to your install):

```json
{
  "mcpServers": {
    "heyvoice": {
      "command": "D:\\Games\\hey voive pros\\backend\\.venv\\Scripts\\python.exe",
      "args": ["D:\\Games\\hey voive pros\\backend\\heyvoice\\mcp_server.py"]
    }
  }
}
```

Restart Claude Desktop. The HeyVoices tools appear under the tools (🔌) menu.

## Claude Code (CLI)

```powershell
claude mcp add heyvoice -- "D:\Games\hey voive pros\backend\.venv\Scripts\python.exe" "D:\Games\hey voive pros\backend\heyvoice\mcp_server.py"
```

## Cursor / other MCP clients

Use the same `mcpServers` JSON block as Claude Desktop — Cursor reads it from
`.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global).

## Example prompts

- "List the voices in HeyVoices, then read this paragraph in the Podcast Guy voice."
- "Generate a two-line game intro: first line in Lighthouse Keeper, second in Kokoro Heart,
  then give me the file path."
- "Make an annoyed voicemail using Chatterbox Turbo with a [sigh]."

The agent sees the absolute `path` of each render, so it can hand the file to other tools
(video editors, `ffmpeg` pipelines, upload scripts) without touching the UI.

## Verifying from the SDK

```python
import asyncio
from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

PY = r"D:\Games\hey voive pros\backend\.venv\Scripts\python.exe"
SRV = r"D:\Games\hey voive pros\backend\heyvoice\mcp_server.py"

async def main():
    async with stdio_client(StdioServerParameters(command=PY, args=[SRV])) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            print([t.name for t in (await s.list_tools()).tools])
            res = await s.call_tool("speak", {"text": "Hello from MCP.", "voice": "Kokoro Heart"})
            print(res.structured_content)

asyncio.run(main())
```

## Implementation notes

- Stdlib-only HTTP (`urllib`) — no extra dependencies beyond `mcp` itself
  (installed via `requirements-core.txt`).
- The file is standalone (no package-relative imports), so it can be launched by path from any
  working directory, exactly as MCP clients do.
- Errors surface as tool errors with actionable messages: HTTP status + backend detail, or a
  "launch the app first" hint when the backend is down.

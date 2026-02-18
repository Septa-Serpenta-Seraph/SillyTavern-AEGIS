# AEGIS — Daemon Terminal Bridge

A SillyTavern extension that gives AI hands.

AEGIS lets AI execute real terminal commands inside a sandboxed Docker container, gated behind a human-approval modal. Every command requires explicit consent before execution.

## Features

- **Approval Gate** — Every command triggers a modal. You approve, deny, or extend the timeout. Nothing runs without your click.
- **Docker Sandbox** — Commands execute inside an isolated container. Your host system is never touched.
- **Safety Shield** — Regex filter blocks destructive patterns (`rm -rf /`, fork bombs, disk formatting, etc.)
- **Base64 Transport** — Encodes commands to survive pipes, quotes, and special characters.
- **Audit Logging** — Every command logged with timestamp, status, and output length.
- **Debounced Scanning** — Prevents duplicate fires during streaming responses.
- **Code-Block Exclusion** — Ignores commands inside markdown code blocks.

## Installation

1. Clone this repo into your SillyTavern extensions folder:
    cd SillyTavern/data/default-user/extensions
   git clone https://github.com/Septa-Serpenta-Seraph/SillyTavern-AEGIS.git
2. Build and start the Docker bridge:

    cd SillyTavern-AEGIS/docker
   docker compose up -d --build
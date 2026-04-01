# YouTube Discord Notifier Bot

## Overview
Discord bot that monitors a YouTube channel and sends notifications to a Discord server when new **videos**, **shorts**, or **live streams** are detected. Pings `@everyone` with a rich embed for each notification.

## Tech Stack
- **Runtime**: Node.js
- **Discord library**: discord.js v14
- **YouTube detection**: YouTube Data API v3 (polling every 60s)
- **Secrets management**: dotenv (`.env` file)
- **Persistence**: JSON file (`data.json`)

## Project Structure
```
DiscordBot/
  index.js        — main bot logic (polling, embeds, notifications)
  .env            — secrets (DISCORD_TOKEN, YOUTUBE_API_KEY, channel IDs)
  .env.example    — safe-to-commit template for .env
  .gitignore      — excludes .env, data.json, node_modules/
  data.json       — auto-created, stores notified video IDs
  package.json    — dependencies and scripts
  CLAUDE.md       — this file
```

## How It Works
1. Bot connects to Discord via bot token
2. Polls YouTube Data API every 60 seconds for new uploads and active live streams
3. Classifies content: **Video** (duration > 60s), **Short** (duration ≤ 60s), **Live** (active broadcast)
4. Sends a rich embed with `@everyone` to the configured Discord channel
5. Persists notified video IDs in `data.json` to avoid duplicates across restarts

## Notification Types
| Type | Embed Color | Detection |
|------|-------------|-----------|
| Video | Red (`#FF0000`) | Upload with duration > 60s |
| Short | Purple (`#9B59B6`) | Upload with duration ≤ 60s |
| Live | Green (`#00FF00`) | Active live broadcast |

## Commands
- `npm install` — install dependencies
- `npm start` — run the bot

## Required Environment Variables (`.env`)
- `DISCORD_TOKEN` — bot token from Discord Developer Portal
- `YOUTUBE_API_KEY` — API key from Google Cloud Console
- `YOUTUBE_CHANNEL_ID` — YouTube channel ID (starts with `UC`)
- `DISCORD_CHANNEL_ID` — target Discord channel ID

## Bot Permissions Required
- Send Messages
- Mention Everyone
- Embed Links

## API Quota
YouTube Data API daily quota: 10,000 units. This bot uses ~200 units/day (well within limits).
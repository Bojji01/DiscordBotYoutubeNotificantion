// index.js
// Discord bot — YouTube upload/short/live stream notifier

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');

// === CONFIGURATION (from .env) ===
const {
  DISCORD_TOKEN,
  YOUTUBE_API_KEY,
  YOUTUBE_CHANNEL_ID,
  DISCORD_CHANNEL_ID,
} = process.env;

const POLL_INTERVAL = 60 * 1000; // 60 seconds
const DATA_FILE = path.join(__dirname, 'data.json');

// === PERSISTENCE ===
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch {
    console.error('Failed to load data.json, starting fresh.');
  }
  return {
    notifiedVideoIds: [],  // videos & shorts already notified
    activeLiveIds: [],     // live streams currently active (notified)
    initialized: false,
  };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let data = loadData();
// Ensure fields exist for old data.json files
if (!data.activeLiveIds) data.activeLiveIds = [];

// === DISCORD CLIENT ===
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// === YOUTUBE CLIENT ===
const youtube = google.youtube({ version: 'v3', auth: YOUTUBE_API_KEY });

// === FIRST RUN: silently record existing videos without notifying ===
async function seedExistingVideos() {
  try {
    const searchRes = await youtube.search.list({
      part: 'snippet',
      channelId: YOUTUBE_CHANNEL_ID,
      order: 'date',
      maxResults: 15,
      type: 'video',
    });
    const items = searchRes.data.items || [];
    for (const item of items) {
      if (!data.notifiedVideoIds.includes(item.id.videoId)) {
        data.notifiedVideoIds.push(item.id.videoId);
      }
    }
    data.initialized = true;
    saveData(data);
    console.log(`📋 Seeded ${items.length} existing videos (no notifications sent).`);
  } catch (err) {
    console.error('Seed error:', err.message || err);
  }
}

// === CONTENT TYPE DETECTION ===
function getContentType(video) {
  // Short: duration <= 60 seconds
  const duration = video.contentDetails?.duration || '';
  const seconds = parseDuration(duration);
  if (seconds > 0 && seconds <= 60) {
    return 'SHORT';
  }
  return 'VIDEO';
}

// Parse ISO 8601 duration (PT1M30S) to seconds
function parseDuration(iso) {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || 0);
  const minutes = parseInt(match[2] || 0);
  const seconds = parseInt(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

// === EMBED BUILDERS ===
const EMBED_CONFIG = {
  VIDEO: {
    color: 0xff0000,
    label: '📹 New Video Uploaded!',
    emoji: '🎬',
  },
  SHORT: {
    color: 0x9b59b6,
    label: '⚡ New Short Uploaded!',
    emoji: '📱',
  },
  LIVE: {
    color: 0x00ff00,
    label: '🔴 Live Stream Started!',
    emoji: '🎙️',
  },
};

function buildEmbed(video, type) {
  const config = EMBED_CONFIG[type];
  const snippet = video.snippet;
  const videoUrl = type === 'SHORT'
    ? `https://youtube.com/shorts/${video.id}`
    : `https://youtu.be/${video.id}`;

  const embed = new EmbedBuilder()
    .setColor(config.color)
    .setTitle(`${config.emoji} ${snippet.title}`)
    .setURL(videoUrl)
    .setDescription(config.label)
    .setImage(
      snippet.thumbnails?.maxres?.url ||
      snippet.thumbnails?.high?.url ||
      snippet.thumbnails?.default?.url
    )
    .addFields(
      { name: 'Channel', value: snippet.channelTitle, inline: true },
      { name: 'Type', value: type, inline: true }
    )
    .setTimestamp(new Date(snippet.publishedAt))
    .setFooter({ text: 'YouTube Notifier' });

  return embed;
}

// === POLL FOR NEW VIDEOS & SHORTS ===
async function pollNewUploads() {
  try {
    // Only fetch the 1 most recent upload
    const searchRes = await youtube.search.list({
      part: 'snippet',
      channelId: YOUTUBE_CHANNEL_ID,
      order: 'date',
      maxResults: 1,
      type: 'video',
    });

    const items = searchRes.data.items;
    if (!items || items.length === 0) return;

    const item = items[0];
    const videoId = item.id.videoId;

    // Already notified about this one
    if (data.notifiedVideoIds.includes(videoId)) return;

    // Get full video details to classify video vs short
    const videoRes = await youtube.videos.list({
      part: 'snippet,contentDetails,liveStreamingDetails',
      id: videoId,
    });

    const video = videoRes.data.items?.[0];
    if (!video) return;

    // Skip if it's currently a live stream (handled by pollLiveStreams)
    const liveBroadcast = video.snippet?.liveBroadcastContent;
    if (liveBroadcast === 'live' || liveBroadcast === 'upcoming') return;

    const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel) {
      console.error('Discord channel not found:', DISCORD_CHANNEL_ID);
      return;
    }

    const type = getContentType(video);
    const embed = buildEmbed(video, type);

    await channel.send({
      content: '@everyone',
      embeds: [embed],
    });

    console.log(`Notified: [${type}] ${video.snippet.title}`);

    data.notifiedVideoIds.push(video.id);
    if (data.notifiedVideoIds.length > 100) {
      data.notifiedVideoIds = data.notifiedVideoIds.slice(-100);
    }
    saveData(data);
  } catch (err) {
    console.error('Upload poll error:', err.message || err);
  }
}

// === POLL FOR ACTIVE LIVE STREAMS ===
async function pollLiveStreams() {
  try {
    const searchRes = await youtube.search.list({
      part: 'snippet',
      channelId: YOUTUBE_CHANNEL_ID,
      eventType: 'live',
      type: 'video',
      maxResults: 3,
    });

    const items = searchRes.data.items || [];
    const currentLiveIds = items.map((item) => item.id.videoId);

    const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel) return;

    // Notify for streams that just went live (not already notified)
    for (const item of items) {
      const videoId = item.id.videoId;
      if (data.activeLiveIds.includes(videoId)) continue;

      // Get full video details
      const videoRes = await youtube.videos.list({
        part: 'snippet,contentDetails,liveStreamingDetails',
        id: videoId,
      });

      const video = videoRes.data.items?.[0];
      if (!video) continue;

      const embed = buildEmbed(video, 'LIVE');

      await channel.send({
        content: '@everyone',
        embeds: [embed],
      });

      console.log(`Notified: [LIVE] ${video.snippet.title}`);

      data.activeLiveIds.push(videoId);
      // Also add to notifiedVideoIds so we don't re-notify as a "new upload" later
      if (!data.notifiedVideoIds.includes(videoId)) {
        data.notifiedVideoIds.push(videoId);
      }
      saveData(data);
    }

    // Clean up ended streams from activeLiveIds
    const ended = data.activeLiveIds.filter((id) => !currentLiveIds.includes(id));
    if (ended.length > 0) {
      data.activeLiveIds = data.activeLiveIds.filter((id) => currentLiveIds.includes(id));
      saveData(data);
      for (const id of ended) {
        console.log(`Stream ended: ${id}`);
      }
    }
  } catch (err) {
    console.error('Live stream poll error:', err.message || err);
  }
}

// === BOT STARTUP ===
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📡 Monitoring YouTube channel: ${YOUTUBE_CHANNEL_ID}`);
  console.log(`📢 Posting to Discord channel: ${DISCORD_CHANNEL_ID}`);

  if (!data.initialized) {
    // First run: seed existing videos, then start polling
    seedExistingVideos().then(() => {
      console.log('🟢 First run complete. Now watching for NEW content only.');
      setInterval(pollNewUploads, POLL_INTERVAL);
      setInterval(pollLiveStreams, POLL_INTERVAL);
    });
  } else {
    // Normal run — poll immediately then schedule
    pollNewUploads();
    pollLiveStreams();
    setInterval(pollNewUploads, POLL_INTERVAL);
    setInterval(pollLiveStreams, POLL_INTERVAL);
  }
});

client.login(DISCORD_TOKEN);

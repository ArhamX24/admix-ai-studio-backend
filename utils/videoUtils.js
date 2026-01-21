// utils/videoUtils.js
import axios from "axios";

/**
 * Cache for avatar and voice data to avoid repeated API calls
 */
const cache = {
  avatars: null,
  voices: null,
  lastFetch: {
    avatars: 0,
    voices: 0
  }
};

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch avatars from HeyGen with caching
 */
async function fetchAvatars() {
  const now = Date.now();
  if (cache.avatars && (now - cache.lastFetch.avatars) < CACHE_DURATION) {
    return cache.avatars;
  }

  try {
    const response = await axios.get("https://api.heygen.com/v2/avatars", {
      headers: {
        "X-Api-Key": process.env.HEYGEN_API_KEY,
        "Content-Type": "application/json"
      }
    });
    cache.avatars = response.data.data.avatars;
    cache.lastFetch.avatars = now;
    return cache.avatars;
  } catch (error) {
    console.error('Error fetching avatars:', error);
    return [];
  }
}

/**
 * Fetch voices from ElevenLabs with caching
 */
async function fetchVoices() {
  const now = Date.now();
  if (cache.voices && (now - cache.lastFetch.voices) < CACHE_DURATION) {
    return cache.voices;
  }

  try {
    const response = await axios.get("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY
      }
    });
    cache.voices = response.data.voices;
    cache.lastFetch.voices = now;
    return cache.voices;
  } catch (error) {
    console.error('Error fetching voices:', error);
    return [];
  }
}

/**
 * Get avatar name and image from avatar ID
 */
export async function getAvatarDetails(avatarId) {
  const avatars = await fetchAvatars();
  const avatar = avatars.find(a => a.avatar_id === avatarId);
  
  return {
    name: avatar ? avatar.avatar_name : avatarId,
    image: avatar ? avatar.preview_image_url : null,
    gender: avatar ? avatar.gender : null
  };
}

/**
 * Get voice name from voice ID
 */
export async function getVoiceDetails(voiceId) {
  const voices = await fetchVoices();
  const voice = voices.find(v => v.voice_id === voiceId);
  
  return {
    name: voice ? voice.name : voiceId,
    previewUrl: voice ? voice.preview_url : null
  };
}

/**
 * Enrich video data with avatar and voice details
 */
export async function enrichVideoData(video) {
  const [avatarDetails, voiceDetails] = await Promise.all([
    getAvatarDetails(video.avatarId),
    getVoiceDetails(video.voiceId)
  ]);

  return {
    ...video,
    avatarName: avatarDetails.name,
    avatarImage: avatarDetails.image,
    voiceName: voiceDetails.name
  };
}

/**
 * Enrich multiple videos with avatar and voice details
 */
export async function enrichVideosData(videos) {
  return await Promise.all(videos.map(video => enrichVideoData(video)));
}
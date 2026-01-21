// utils/durationUtils.js

/**
 * Convert duration string to seconds (float)
 * @param {string} durationStr - Duration string like "15s", "30s", "60s", or "Auto"
 * @returns {number|null} - Duration in seconds or null for "Auto"
 * 
 * Examples:
 * "15s" -> 15.0
 * "30s" -> 30.0
 * "60s" -> 60.0
 * "1m" -> 60.0
 * "Auto" -> null
 */
export function parseDuration(durationStr) {
  if (!durationStr || durationStr === "Auto") {
    return null; // Auto duration - let HeyGen decide based on script length
  }

  // Remove whitespace
  const cleaned = durationStr.trim().toLowerCase();

  // Match patterns like "15s", "30s", "1m", "1.5m"
  const secondsMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?$/);
  if (secondsMatch) {
    return parseFloat(secondsMatch[1]);
  }

  const minutesMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?$/);
  if (minutesMatch) {
    return parseFloat(minutesMatch[1]) * 60;
  }

  // If it's just a number, assume seconds
  const numberMatch = cleaned.match(/^(\d+(?:\.\d+)?)$/);
  if (numberMatch) {
    return parseFloat(numberMatch[1]);
  }

  // Default to null if can't parse
  console.warn(`Could not parse duration: ${durationStr}, defaulting to Auto`);
  return null;
}

/**
 * Format duration for display
 * @param {number|null} seconds - Duration in seconds
 * @returns {string} - Formatted duration string
 * 
 * Examples:
 * 15 -> "15s"
 * 30 -> "30s"
 * 60 -> "1m"
 * 90 -> "1m 30s"
 * null -> "Auto"
 */
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) {
    return "Auto";
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Validate if duration is within acceptable range
 * @param {number|null} seconds - Duration in seconds
 * @param {number} minSeconds - Minimum allowed duration (default: 5)
 * @param {number} maxSeconds - Maximum allowed duration (default: 300 = 5 minutes)
 * @returns {boolean} - Whether duration is valid
 */
export function isValidDuration(seconds, minSeconds = 5, maxSeconds = 300) {
  if (seconds === null) {
    return true; // Auto is always valid
  }

  return seconds >= minSeconds && seconds <= maxSeconds;
}

/**
 * Get duration constraints for HeyGen API
 * @param {number|null} targetDuration - Desired duration in seconds
 * @returns {object|null} - Duration constraint object for HeyGen API
 */
export function getDurationConstraint(targetDuration) {
  if (targetDuration === null) {
    return null; // No constraint - auto duration
  }

  return {
    duration: targetDuration,
    fit: true // Fit content to specified duration
  };
}
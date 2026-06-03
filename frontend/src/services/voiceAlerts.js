const VOICE_KEY = "voice_alerts_enabled";

const LAST_SEEN_KEY = "voice_alerts_last_seen_id";

export function isVoiceSupported() {

  return (
    typeof window !== "undefined"
    && "speechSynthesis" in window
    && "SpeechSynthesisUtterance" in window
  );
}

export function isVoiceEnabled() {

  return localStorage.getItem(VOICE_KEY) === "true";
}

export function setVoiceEnabled(enabled) {

  localStorage.setItem(
    VOICE_KEY,
    enabled ? "true" : "false"
  );
}

export function getLastSeenId() {

  const val = localStorage.getItem(LAST_SEEN_KEY);

  return val ? parseInt(val, 10) : 0;
}

export function setLastSeenId(id) {

  localStorage.setItem(LAST_SEEN_KEY, String(id));
}

export function speak(text, opts = {}) {

  if (!isVoiceSupported()) {

    return false;
  }

  if (!text || !text.trim()) {

    return false;
  }

  try {

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    utterance.rate = opts.rate ?? 1;

    utterance.pitch = opts.pitch ?? 1;

    utterance.volume = opts.volume ?? 1;

    utterance.lang = opts.lang ?? "en-US";

    const voices = window.speechSynthesis.getVoices();

    const preferred =
      voices.find(
        (v) =>
          v.lang.startsWith("en")
          && /female|samantha|zira|google/i.test(v.name)
      ) ||
      voices.find((v) => v.lang.startsWith("en"));

    if (preferred) {

      utterance.voice = preferred;
    }

    window.speechSynthesis.speak(utterance);

    return true;

  } catch (e) {

    console.log("Voice alert failed:", e);

    return false;
  }
}

export function stopSpeaking() {

  if (isVoiceSupported()) {

    window.speechSynthesis.cancel();
  }
}

export function buildAlertSpeech(title, message) {

  const cleanMsg = (message || "")
    .replace(/[<>]/g, "")
    .trim();

  return `Alert. ${title}. ${cleanMsg}`;
}

export function buildMorningBriefing({
  employeeName,
  department,
  dayNumber,
  taskName,
  taskDetails,
  taskStatus
}) {

  const name = (employeeName || "Employee").trim();

  const dept = (department || "").trim();

  const cleanTask = (taskName || "").replace(/[<>]/g, "").trim();

  const cleanDetails = (taskDetails || "")
    .replace(/[<>]/g, "")
    .trim();

  const parts = [];

  parts.push(`Good morning, ${name}.`);

  if (dept) {

    parts.push(`Welcome to the ${dept} department.`);
  }

  if (dayNumber) {

    parts.push(`This is day ${dayNumber} of your thirty-day plan.`);
  }

  if (cleanTask) {

    parts.push(`Today's task: ${cleanTask}.`);

    if (cleanDetails) {

      parts.push(cleanDetails);
    }

    if (taskStatus && taskStatus !== "PENDING") {

      parts.push(
        `Current status: ${taskStatus.replace(/_/g, " ").toLowerCase()}.`
      );
    }

  } else {

    parts.push("You have no task scheduled for today.");
  }

  parts.push("Have a productive day at Bharath Vending Corporation.");

  return parts.join(" ");
}

const MORNING_HOUR = 9;

const MORNING_MIN = 15;

const MORNING_WINDOW_MIN = 5;

const MORNING_LAST_KEY = "voice_morning_last_date";

export function isMorningBriefingWindow(now = new Date()) {

  const startMin = MORNING_HOUR * 60 + MORNING_MIN;

  const endMin = startMin + MORNING_WINDOW_MIN;

  const nowMin = now.getHours() * 60 + now.getMinutes();

  return nowMin >= startMin && nowMin < endMin;
}

export function hasAnnouncedToday(now = new Date()) {

  const todayKey = now.toISOString().slice(0, 10);

  return localStorage.getItem(MORNING_LAST_KEY) === todayKey;
}

export function markAnnouncedToday(now = new Date()) {

  const todayKey = now.toISOString().slice(0, 10);

  localStorage.setItem(MORNING_LAST_KEY, todayKey);
}

export function resetMorningAnnouncement() {

  localStorage.removeItem(MORNING_LAST_KEY);
}

// Teacher live dashboard transport: Server-Sent Events fan-out plus throttled
// presence bookkeeping. Deliberately in-memory and single-process — correct for
// one school LXC, and documented as the scaling boundary.
import { config } from '../config.js';

/** assignmentId -> Set<ServerResponse> */
const subscribers = new Map();
/** participantId -> { assignmentId, lastPublishedMs } */
const presence = new Map();

export const PRESENCE_ONLINE_MS = 35000;
const PRESENCE_PUBLISH_INTERVAL_MS = 15000;

export function sseOpen(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':ok\n\n');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

export function sseSend(res, data) {
  if (!res || res.writableEnded || res.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* client gone — close handler cleans up */
  }
}

export function subscribe(assignmentId, res) {
  let set = subscribers.get(assignmentId);
  if (!set) {
    set = new Set();
    subscribers.set(assignmentId, set);
  }
  set.add(res);
  return function unsubscribe() {
    const current = subscribers.get(assignmentId);
    if (!current) return;
    current.delete(res);
    if (current.size === 0) subscribers.delete(assignmentId);
  };
}

export function publish(assignmentId, event) {
  const set = subscribers.get(assignmentId);
  if (!set || set.size === 0) return 0;
  for (const res of set) sseSend(res, event);
  return set.size;
}

export function subscriberCount(assignmentId) {
  return subscribers.get(assignmentId)?.size || 0;
}

export function closeAll() {
  for (const set of subscribers.values()) {
    for (const res of set) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
  }
  subscribers.clear();
}

/**
 * Record that a participant did something. Returns true when callers should
 * publish a presence event (throttled to once per 15 s per participant).
 */
export function touchPresence(participantId, assignmentId) {
  const ms = Date.now();
  const prev = presence.get(participantId);
  if (!prev || prev.assignmentId !== assignmentId) {
    presence.set(participantId, { assignmentId, lastPublishedMs: ms });
    return true;
  }
  if (ms - prev.lastPublishedMs >= PRESENCE_PUBLISH_INTERVAL_MS) {
    prev.lastPublishedMs = ms;
    return true;
  }
  return false;
}

export function forgetPresence(participantId) {
  presence.delete(participantId);
}

export function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  const ms = Date.parse(lastSeenAt);
  return Number.isFinite(ms) && Date.now() - ms <= PRESENCE_ONLINE_MS;
}

/** Keepalive comments keep proxies and sleeping laptops from dropping the stream. */
export function startHeartbeat(intervalMs = 25000) {
  const timer = setInterval(() => {
    for (const set of subscribers.values()) {
      for (const res of set) {
        if (res.writableEnded || res.destroyed) continue;
        try {
          res.write(':ping\n\n');
        } catch {
          /* ignore */
        }
      }
    }
    // Drop presence entries for participants we have not heard from in a while.
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [id, entry] of presence) {
      if (entry.lastPublishedMs < cutoff) presence.delete(id);
    }
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

export function debugState() {
  return {
    channels: subscribers.size,
    connections: [...subscribers.values()].reduce((n, set) => n + set.size, 0),
    presenceEntries: presence.size,
    nodeEnv: config.nodeEnv,
  };
}

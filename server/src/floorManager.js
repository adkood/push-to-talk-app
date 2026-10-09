export class FloorManager {
  constructor(defaultTtlMs = 2500) {
    this.defaultTtlMs = defaultTtlMs;
    this.rooms = new Map();
  }

  getCurrentSpeaker(roomId) {
    const state = this.rooms.get(roomId);
    if (!state || !state.currentSpeaker) return null;
    if (Date.now() > state.expiresAt) {
      this.clearFloor(roomId);
      return null;
    }
    return state.currentSpeaker;
  }

  acquireFloor(roomId, user, onExpireCallback) {
    const existing = this.getCurrentSpeaker(roomId);
    if (existing) {
      if (existing.userId === user.userId) {
        this.heartbeat(roomId, user.userId);
        return { success: true, currentSpeaker: existing };
      }
      return { success: false, currentSpeaker: existing };
    }

    const expiresAt = Date.now() + this.defaultTtlMs;
    const timer = setTimeout(() => {
      const expired = this.clearFloor(roomId);
      if (expired && onExpireCallback) onExpireCallback(roomId, expired);
    }, this.defaultTtlMs);

    this.rooms.set(roomId, { currentSpeaker: user, expiresAt, timer, onExpireCallback });
    return { success: true, currentSpeaker: user };
  }

  heartbeat(roomId, userId) {
    const state = this.rooms.get(roomId);
    if (!state || !state.currentSpeaker || state.currentSpeaker.userId !== userId) {
      return false;
    }

    if (state.timer) clearTimeout(state.timer);
    state.expiresAt = Date.now() + this.defaultTtlMs;
    state.timer = setTimeout(() => {
      const expired = this.clearFloor(roomId);
      if (expired && state.onExpireCallback) state.onExpireCallback(roomId, expired);
    }, this.defaultTtlMs);

    return true;
  }

  releaseFloor(roomId, userId) {
    const state = this.rooms.get(roomId);
    if (!state || !state.currentSpeaker || state.currentSpeaker.userId !== userId) {
      return false;
    }
    this.clearFloor(roomId);
    return true;
  }

  clearFloor(roomId) {
    const state = this.rooms.get(roomId);
    if (!state) return null;
    if (state.timer) clearTimeout(state.timer);
    const speaker = state.currentSpeaker;
    this.rooms.delete(roomId);
    return speaker;
  }
}

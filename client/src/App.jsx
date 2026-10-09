import { useState, useRef } from 'react';
import { usePushToTalk } from './usePushToTalk';
import './App.css';

export default function App() {
  const [inputName, setInputName] = useState('');
  const remoteAudioRef = useRef(null);

  const {
    userId,
    userName,
    registered,
    users,
    currentCall,
    callError,
    voiceConnected,
    state,
    registerUser,
    startCall,
    leaveCall,
    startTalking,
    stopTalking,
    toggleTalking,
  } = usePushToTalk({ remoteAudioRef });

  // Spacebar hotkey inside call
  const handleKeyDown = (e) => {
    if (currentCall && e.code === 'Space' && !e.repeat && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      startTalking();
    }
  };

  const handleKeyUp = (e) => {
    if (currentCall && e.code === 'Space' && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      stopTalking();
    }
  };

  // Screen 1: Enter Name
  if (!registered) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-icon">🎙️</div>
          <h2>Push-To-Talk Voice</h2>
          <p className="login-subtitle">Enter your name to join</p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              registerUser(inputName);
            }}
          >
            <input
              type="text"
              autoFocus
              className="name-input"
              placeholder="e.g. Alice"
              value={inputName}
              onChange={(e) => setInputName(e.target.value)}
              required
            />
            <button type="submit" className="join-btn" disabled={!inputName.trim()}>
              Join Lobby &amp; Enable Mic
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Filter other users
  const otherUsers = users.filter((u) => u.userId !== userId);

  return (
    <div className="app-shell" tabIndex={0} onKeyDown={handleKeyDown} onKeyUp={handleKeyUp}>
      {/* Hidden Audio element for remote WebRTC voice playback */}
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />

      {/* Top Navigation */}
      <header className="navbar">
        <div className="logo-group">
          <span className="logo-icon">📻</span>
          <span className="logo-text">Push-To-Talk</span>
        </div>
        <div className="user-badge">
          Logged in as <strong>{userName}</strong>
        </div>
      </header>

      {/* Call Error Banner */}
      {callError && <div className="error-banner">⚠️ {callError}</div>}

      {/* Screen 2: 1-on-1 Call View */}
      {currentCall ? (
        <main className="call-view">
          <div className="call-header">
            <div>
              <span className="call-label">In Call with</span>
              <h1 className="partner-name">{currentCall.partner.userName}</h1>
              <div className="voice-status-pill">
                <span className={`status-circle ${voiceConnected ? 'online-dot' : 'busy-dot'}`}></span>
                <span>{voiceConnected ? 'Audio Connected (WebRTC)' : 'Connecting Audio Channel...'}</span>
              </div>
            </div>
            <button onClick={leaveCall} className="leave-btn">
              End Call
            </button>
          </div>

          {/* Central PTT Button */}
          <div className="ptt-zone">
            <button
              id="ptt-action-btn"
              className={`ptt-core-btn ${state.toLowerCase()}`}
              onMouseDown={startTalking}
              onMouseUp={stopTalking}
              onMouseLeave={stopTalking}
              onTouchStart={(e) => {
                e.preventDefault();
                startTalking();
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                stopTalking();
              }}
              onClick={toggleTalking}
              disabled={state === 'LISTENING' || state === 'FLOOR_BUSY'}
            >
              <div className="ptt-btn-icon">
                {state === 'SPEAKING' ? '🎙️' : state === 'LISTENING' ? '🔊' : '🎤'}
              </div>
              <div className="ptt-btn-title">
                {state === 'SPEAKING'
                  ? 'YOU ARE SPEAKING'
                  : state === 'REQUESTING_FLOOR'
                  ? 'ACQUIRING...'
                  : state === 'LISTENING'
                  ? `${currentCall.partner.userName.toUpperCase()} IS SPEAKING`
                  : state === 'FLOOR_BUSY'
                  ? 'PLEASE WAIT'
                  : 'PUSH TO TALK'}
              </div>
              <div className="ptt-btn-hint">
                {state === 'SPEAKING'
                  ? 'Release to mute'
                  : state === 'LISTENING'
                  ? 'Receiving live audio'
                  : 'Hold button or Spacebar (or tap)'}
              </div>
            </button>

            {/* Audio Wave Indicator */}
            {(state === 'SPEAKING' || state === 'LISTENING') && (
              <div className="live-waveform">
                <span></span>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
              </div>
            )}
          </div>
        </main>
      ) : (
        /* Screen 3: Online Users Lobby */
        <main className="lobby-view">
          <div className="lobby-header">
            <div>
              <h2>Online Users</h2>
              <p className="lobby-sub">Select an available user to start a direct voice conversation</p>
            </div>
            <span className="count-pill">{otherUsers.length} Online</span>
          </div>

          <div className="user-list">
            {otherUsers.length === 0 ? (
              <div className="empty-lobby">
                <p>No other users online right now.</p>
                <p className="empty-hint">Open this link in another browser tab or on your mobile device to test!</p>
              </div>
            ) : (
              otherUsers.map((u) => {
                const isBusy = u.status === 'BUSY';
                return (
                  <div key={u.userId} className={`user-card ${isBusy ? 'busy-card' : ''}`}>
                    <div className="user-info">
                      <div className="avatar">{u.userName.charAt(0).toUpperCase()}</div>
                      <div>
                        <div className="user-title">{u.userName}</div>
                        <div className="user-status-line">
                          <span className={`status-circle ${isBusy ? 'busy-dot' : 'online-dot'}`}></span>
                          <span className="status-text">{isBusy ? 'In a call (Busy)' : 'Available'}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      className={`call-action-btn ${isBusy ? 'busy-btn' : 'available-btn'}`}
                      disabled={isBusy}
                      onClick={() => startCall(u.userId)}
                    >
                      {isBusy ? 'Busy' : 'Talk'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </main>
      )}
    </div>
  );
}

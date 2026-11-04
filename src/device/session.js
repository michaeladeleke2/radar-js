// One radar connection shared by every tab, like SensDSv2's RadarBridge:
// frames go to every subscriber as they arrive (raw_frame_ready).
//
// The radar code is loaded only on Connect Radar, so the page still works for
// recordings in a browser without Web Serial.
//
// radar-js change: sensds-web's connectRadar() opened the board and started
// streaming in one step. Here it is split into connectRadar() (port picker and
// handshake), startRadar() and stopRadar(); the streaming loop, restart and
// reconnect logic are unchanged. A generation number stops a loop left over
// from an earlier start from acting after a new start.

const subscribers = new Set();
const stateListeners = new Set();
const session = { port: null, device: null, running: false, drops: 0, frames: 0, mod: null, restarts: 0, goodSinceRestart: 0, gen: 0, info: null, restartsTotal: 0 };
const MAX_RESTARTS = 3;          // in a row, before giving up

export const isConnected = () => Boolean(session.device);
export const isStreaming = () => session.running;
// { firmware, chip, board } from the handshake, or null when not connected
export const boardInfo = () => session.info;
// radar-js: restarts since Start, and the device's loss diagnostics (why frames were dropped)
export const radarStats = () => ({ frames: session.frames, drops: session.drops, restarts: session.restartsTotal, diagnostics: session.device?.diagnostics?.() ?? null });
export const hasWebSerial = () => 'serial' in navigator;

// fn(cube, meta): cube is a Float32Array (3 x 128 x 256), the same as Python's
// get_next_frame()[0], a new array every frame. meta (radar-js addition):
// { index (1-based frame count since start), counter (16-bit packet counter of
// the frame's first data packet), timestamp (firmware slice timestamp, or null
// when the firmware sends none) }.
export function subscribeFrames(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }

// fn({ connected, streaming, message, restarted })
export function onRadarState(fn) { stateListeners.add(fn); return () => stateListeners.delete(fn); }
const emit = (connected, message, restarted = false) => { for (const fn of stateListeners) fn({ connected, streaming: session.running, message, restarted }); };

export async function connectRadar() {
  try { session.mod = await import('./device.js'); }
  catch { emit(false, 'Live radar is not included in this website build. Open a recording instead.'); return false; }

  let port;
  try { port = await navigator.serial.requestPort({ filters: [{ usbVendorId: session.mod.INFINEON_VID }] }); }
  catch { emit(false, 'No radar selected.'); return false; }

  emit(false, 'Connecting to the radar…');
  const device = new session.mod.RadarDevice(port, { log: m => console.debug('[radar]', m) });
  let info;
  try {
    info = await device.open();
  } catch (e) {
    await device.close().catch(() => {});
    emit(false, `Could not connect to the radar: ${e.message}`);
    return false;
  }
  Object.assign(session, { port, device, running: false, info });
  emit(true, `Radar found: ${info.board || 'board'}, BGT60TR13C, firmware ${info.firmware}.`);
  return info;
}

export async function startRadar() {
  if (!session.device || session.running) return false;
  try {
    await session.device.start();
  } catch (e) {
    emit(true, `Could not start the radar: ${e.message}`);
    return false;
  }
  Object.assign(session, { running: true, drops: 0, frames: 0, restarts: 0, goodSinceRestart: 0, restartsTotal: 0 });
  emit(true, 'Radar streaming: BGT60TR13C, 3 antennas, 10 frames per second.');
  loop(++session.gen);
  return true;
}

export async function stopRadar() {
  if (!session.device || !session.running) return;
  session.running = false;
  try { await session.device.stop(); }
  catch (e) { console.warn('[radar] stop failed:', e.message); }
  emit(true, `Radar stopped after ${session.frames} frames.`);
}

async function loop(gen) {
  const { mod } = session;
  const live = () => session.running && session.gen === gen;
  while (live()) {
    try {
      const cube = await session.device.nextFrame();
      if (!live()) break;
      session.frames++;
      if (++session.goodSinceRestart >= 50) session.restarts = 0;   // streaming fine again
      // radar-js: frame metadata from the device (see device.js lastFrameMeta)
      const m = session.device.lastFrameMeta ?? {};
      const meta = { index: session.frames, counter: m.counter ?? null, timestamp: m.timestamp ? Number(m.timestamp) : null };
      for (const fn of subscribers) fn(cube, meta);
    } catch (e) {
      if (!live()) break;
      // radar-js change: a dropped slice also restarts the acquisition.
      // sensds-web (as SensDSv2 and the SDK's get_next_raw_frame) skipped it and
      // went on, but the reader then starts its next frame at whatever slice
      // comes next, mid-frame, and every later frame stays shifted (found on the
      // board 2026-11-04: antennas rotated, chirps cut 86 samples late; see
      // PROGRESS.md and test/frame_alignment.test.ts). A restart begins again
      // at a true frame boundary.
      const dropped = e instanceof mod.FrameAcquisitionFailed;
      if (dropped) session.drops++;
      // A FIFO overflow or a gap in the data (the page was busy and the board's
      // buffer filled) does not need a new connection: restart the acquisition.
      // The desktop stops here; it reads the radar on its own thread, so it
      // rarely falls behind.
      const recoverable = dropped || e instanceof mod.FifoOverflow || e instanceof mod.FrameSizeNotSupported || /Timeout waiting for radar data/.test(e.message);
      // A drop's restart does not count toward MAX_RESTARTS (drops can be frequent
      // and the restart is routine); a restart that fails still escalates below.
      if (recoverable && (dropped || session.restarts < MAX_RESTARTS)) {
        if (!dropped) { session.restarts++; session.goodSinceRestart = 0; }
        session.restartsTotal++;
        console.warn('[radar] restarting acquisition after:', e.message);
        emit(true, dropped ? `Radar realigned after a dropped frame (${session.drops} so far)` : `Radar restarted after: ${e.message} (${session.restarts}/${MAX_RESTARTS})`, true);
        try { await session.device.restart(); continue; }
        catch (err) {
          // The board did not take the restart: reopen the port and start
          // again, as Disconnect then Connect would, without asking for the port
          console.warn('[radar] restart failed, reconnecting:', err.message);
          if (await reconnect()) continue;
          await disconnectRadar(`Radar stopped: could not restart (${err.message})`);
          return;
        }
      }
      await disconnectRadar(`Radar stopped: ${e.message}`);
      return;
    }
  }
}

async function reconnect() {
  const { mod, port } = session;
  emit(true, 'Radar not answering. Reconnecting…', true);
  try { await session.device.close(); } catch { /* already gone */ }
  await new Promise(r => setTimeout(r, 500));
  const device = new mod.RadarDevice(port, { log: m => console.debug('[radar]', m) });
  try {
    await device.open();
    await device.start();
  } catch (e) {
    console.warn('[radar] reconnect failed:', e.message);
    try { await device.close(); } catch { /* nothing open */ }
    session.device = null;
    return false;
  }
  session.device = device;
  emit(true, 'Radar reconnected and streaming.', true);
  return true;
}

export async function disconnectRadar(message) {
  const device = session.device;
  session.running = false;
  session.device = null;
  session.info = null;
  if (device) await device.close();
  emit(false, message ?? `Radar disconnected after ${session.frames} frames.`);
}

// Web MIDI input. Optional: the drill works from the letter buttons alone.
//
// Chrome and Edge implement this. Safari does not, so on a Mac you need
// Chrome if you want to answer from the keyboard you actually play.

/**
 * @param {(midiNote: number) => void} onNote
 * @param {(status: {available: boolean, deviceName: string | null, error: string | null}) => void} onStatus
 */
export async function connect(onNote, onStatus) {
  if (!navigator.requestMIDIAccess) {
    onStatus({ available: false, deviceName: null, error: "This browser has no Web MIDI. Chrome or Edge do." });
    return;
  }

  /** @type {MIDIAccess} */
  let access;
  try {
    access = await navigator.requestMIDIAccess();
  } catch (err) {
    onStatus({ available: false, deviceName: null, error: "MIDI access was refused." });
    return;
  }

  const attach = () => {
    let name = null;
    for (const input of access.inputs.values()) {
      input.onmidimessage = (msg) => {
        const [status, note, velocity] = msg.data;
        // 0x90 is note-on; a note-on with zero velocity is a note-off.
        if ((status & 0xf0) === 0x90 && velocity > 0) onNote(note);
      };
      name = name ?? input.name;
    }
    onStatus({
      available: name !== null,
      deviceName: name,
      error: name ? null : "No MIDI device found. Plug one in and it will connect.",
    });
  };

  access.onstatechange = attach;
  attach();
}

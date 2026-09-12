import type { SignalingClient } from './websocket'

export const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

export async function getCameraAndMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: true, audio: true })
}

export async function getScreenShare(): Promise<MediaStream> {
  // Cast because getDisplayMedia isn't in every lib.dom typing version.
  return (navigator.mediaDevices as any).getDisplayMedia({ video: true })
}

interface PeerEntry {
  pc: RTCPeerConnection
  pendingIce: RTCIceCandidateInit[]
}

/**
 * Runs on the candidate's browser. Maintains one RTCPeerConnection per
 * proctor that is watching this candidate, and publishes the camera,
 * microphone and screen tracks on each of them.
 */
export class CandidatePeerManager {
  private peers = new Map<string, PeerEntry>()

  constructor(
    private signaling: SignalingClient,
    private cameraStream: MediaStream,
    private screenStream: MediaStream,
    private onStateChange: (state: RTCPeerConnectionState) => void,
  ) {}

  private ensurePeer(proctorId: string): PeerEntry {
    let entry = this.peers.get(proctorId)
    if (entry) return entry

    const pc = new RTCPeerConnection(ICE_SERVERS)
    entry = { pc, pendingIce: [] }
    this.peers.set(proctorId, entry)

    this.cameraStream.getTracks().forEach((track) => pc.addTrack(track, this.cameraStream))
    this.screenStream.getTracks().forEach((track) => pc.addTrack(track, this.screenStream))

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.send({
          type: 'ice-candidate',
          to: proctorId,
          payload: event.candidate.toJSON(),
        })
      }
    }

    pc.onconnectionstatechange = () => {
      this.onStateChange(pc.connectionState)
    }

    return entry
  }

  async handleRequestOffer(proctorId: string): Promise<void> {
    const { pc } = this.ensurePeer(proctorId)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    this.signaling.send({ type: 'offer', to: proctorId, payload: offer })
  }

  async handleAnswer(proctorId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const entry = this.peers.get(proctorId)
    if (!entry) return
    await entry.pc.setRemoteDescription(new RTCSessionDescription(sdp))
    for (const candidate of entry.pendingIce) {
      await entry.pc.addIceCandidate(new RTCIceCandidate(candidate))
    }
    entry.pendingIce = []
  }

  async handleIceCandidate(proctorId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const entry = this.peers.get(proctorId)
    if (!entry) return
    if (entry.pc.remoteDescription) {
      await entry.pc.addIceCandidate(new RTCIceCandidate(candidate))
    } else {
      entry.pendingIce.push(candidate)
    }
  }

  handleProctorLeft(proctorId: string): void {
    const entry = this.peers.get(proctorId)
    if (entry) {
      entry.pc.close()
      this.peers.delete(proctorId)
    }
  }

  closeAll(): void {
    this.peers.forEach((entry) => entry.pc.close())
    this.peers.clear()
  }
}

export interface RemoteCandidateStreams {
  camera?: MediaStream
  screen?: MediaStream
}

/**
 * Runs on the proctor's browser. Maintains one RTCPeerConnection per
 * candidate being observed, and surfaces their camera/screen streams.
 */
export class ProctorPeerManager {
  private peers = new Map<string, PeerEntry>()

  constructor(
    private signaling: SignalingClient,
    private onStreams: (candidateId: string, streams: RemoteCandidateStreams) => void,
    private onStateChange: (candidateId: string, state: RTCPeerConnectionState) => void,
  ) {}

  private ensurePeer(candidateId: string): PeerEntry {
    let entry = this.peers.get(candidateId)
    if (entry) return entry

    const pc = new RTCPeerConnection(ICE_SERVERS)
    entry = { pc, pendingIce: [] }
    this.peers.set(candidateId, entry)

    const seenStreams: RemoteCandidateStreams = {}

    pc.ontrack = (event) => {
      const [stream] = event.streams
      if (!stream) return
      // A stream that carries an audio track is the camera/mic stream;
      // a video-only stream is the screen share.
      const kind = stream.getAudioTracks().length > 0 ? 'camera' : 'screen'
      seenStreams[kind] = stream
      this.onStreams(candidateId, { ...seenStreams })
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.send({
          type: 'ice-candidate',
          to: candidateId,
          payload: event.candidate.toJSON(),
        })
      }
    }

    pc.onconnectionstatechange = () => {
      this.onStateChange(candidateId, pc.connectionState)
    }

    return entry
  }

  async handleOffer(candidateId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const entry = this.ensurePeer(candidateId)
    await entry.pc.setRemoteDescription(new RTCSessionDescription(sdp))

    // The proctor never captures its own camera/mic and must never send
    // media back to a candidate - only receive. Pinning every transceiver
    // to recvonly here keeps that true structurally, even if a future
    // change accidentally attaches local tracks on this side.
    entry.pc.getTransceivers().forEach((t) => {
      t.direction = 'recvonly'
    })

    for (const candidate of entry.pendingIce) {
      await entry.pc.addIceCandidate(new RTCIceCandidate(candidate))
    }
    entry.pendingIce = []

    const answer = await entry.pc.createAnswer()
    await entry.pc.setLocalDescription(answer)
    this.signaling.send({ type: 'answer', to: candidateId, payload: answer })
  }

  async handleIceCandidate(candidateId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const entry = this.peers.get(candidateId)
    if (!entry) return
    if (entry.pc.remoteDescription) {
      await entry.pc.addIceCandidate(new RTCIceCandidate(candidate))
    } else {
      entry.pendingIce.push(candidate)
    }
  }

  handleCandidateLeft(candidateId: string): void {
    const entry = this.peers.get(candidateId)
    if (entry) {
      entry.pc.close()
      this.peers.delete(candidateId)
    }
  }

  closeAll(): void {
    this.peers.forEach((entry) => entry.pc.close())
    this.peers.clear()
  }
}
/**
 * 隔空快传核心双引擎通信客户端
 * - 发现与信令：连接独立后端 /ws/lan（支持同局域网自动发现 + 6 位配对码跨网连接）
 * - 主力通道（P2P）：WebRTC RTCDataChannel 局域网加密点对点直传（64 KB 分片 + 背压流控）
 * - 极端网络兜底（Relay）：WebRTC 4.5s 内未连上或被防火墙拦截时，自动无感切换为服务端纯内存二进制流透传（绝不落盘）
 */

import { downloadBlob } from '@/lib/file'
import { uid } from '@/lib/utils'
import {
  detectLocalDevice,
  formatShortTime,
  type ActiveTransfer,
  type ConnectionState,
  type FileDescriptor,
  type IncomingOffer,
  type PeerInfo,
  type ReceivedFileItem,
  type TextMessageItem,
  type TransferTransport,
} from './types'

const P2P_CHUNK_SIZE = 64 * 1024
const P2P_HIGH_WATERMARK = 512 * 1024
const RELAY_CHUNK_SIZE = 32 * 1024
const RELAY_HIGH_WATERMARK = 512 * 1024
const P2P_CONNECT_TIMEOUT_MS = 4500

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.qq.com:3478' },
  ],
}

export interface LanClientCallbacks {
  onConnectionChange: (state: ConnectionState) => void
  onWelcome: (payload: { self: PeerInfo; peers: PeerInfo[]; roomLabel: string; pairCode: string | null }) => void
  onSelfUpdated: (self: PeerInfo) => void
  onPeerJoined: (peer: PeerInfo) => void
  onPeerLeft: (peerId: string) => void
  onPeerUpdated: (peer: PeerInfo) => void
  onIncomingOffer: (offer: IncomingOffer) => void
  onTransferUpdate: (transfer: ActiveTransfer) => void
  onFileReceived: (file: ReceivedFileItem) => void
  onTextReceived: (msg: TextMessageItem) => void
  onToast: (type: 'info' | 'success' | 'error', message: string) => void
}

interface OutgoingSession {
  transferId: string
  peerId: string
  peerName: string
  files: File[]
  descriptors: FileDescriptor[]
  totalSize: number
  transport: TransferTransport
  pc?: RTCPeerConnection
  dc?: RTCDataChannel
  watchdog?: number
  cancelled: boolean
  startedStreaming: boolean
  acceptResolver?: (accepted: boolean) => void
}

interface IncomingSession {
  transferId: string
  peerId: string
  peerName: string
  transport: TransferTransport
  files: FileDescriptor[]
  totalSize: number
  pc?: RTCPeerConnection
  dc?: RTCDataChannel
  accepted: boolean
  cancelled: boolean
  currentFileIndex: number
  currentChunks: Uint8Array[]
  currentFileReceived: number
  totalReceived: number
  lastSpeedTs: number
  lastSpeedBytes: number
  speedBps: number
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/** 编码发往服务端的二进制中转帧：[1B targetIdLen][targetId][1B transferIdLen][transferId][chunk] */
function encodeRelayFrame(targetPeerId: string, transferId: string, chunk: Uint8Array): Uint8Array {
  const peerBytes = textEncoder.encode(targetPeerId)
  const txBytes = textEncoder.encode(transferId)
  const buf = new Uint8Array(1 + peerBytes.length + 1 + txBytes.length + chunk.byteLength)
  let offset = 0
  buf[offset++] = peerBytes.length
  buf.set(peerBytes, offset)
  offset += peerBytes.length
  buf[offset++] = txBytes.length
  buf.set(txBytes, offset)
  offset += txBytes.length
  buf.set(chunk, offset)
  return buf
}

/** 解码服务端转发来的二进制中转帧：[1B senderIdLen][senderId][1B transferIdLen][transferId][chunk] */
function decodeRelayFrame(buffer: ArrayBuffer): { senderId: string; transferId: string; chunk: Uint8Array } | null {
  const view = new Uint8Array(buffer)
  if (view.length < 4) return null
  const senderLen = view[0]
  if (view.length < 2 + senderLen) return null
  const senderId = textDecoder.decode(view.subarray(1, 1 + senderLen))
  const txLenPos = 1 + senderLen
  const txLen = view[txLenPos]
  const dataStart = txLenPos + 1 + txLen
  if (view.length < dataStart) return null
  const transferId = textDecoder.decode(view.subarray(txLenPos + 1, dataStart))
  const chunk = view.subarray(dataStart)
  return { senderId, transferId, chunk }
}

export class LanTransferClient {
  private ws: WebSocket | null = null
  private callbacks: LanClientCallbacks
  private disposed = false
  private reconnectTimer: number | null = null
  private reconnectAttempt = 0
  private autoAccept = false
  private customName = ''
  private desiredPairCode: string | null = null

  private peers = new Map<string, PeerInfo>()
  private outgoing = new Map<string, OutgoingSession>()
  private incoming = new Map<string, IncomingSession>()

  constructor(callbacks: LanClientCallbacks, options?: { customName?: string; initialPairCode?: string | null }) {
    this.callbacks = callbacks
    this.customName = options?.customName ?? ''
    this.desiredPairCode = options?.initialPairCode ?? null
  }

  public setAutoAccept(enabled: boolean) {
    this.autoAccept = enabled
  }

  public connect() {
    if (this.disposed) return
    this.cleanupWs()
    this.callbacks.onConnectionChange('connecting')

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const query = this.desiredPairCode ? `?room=${encodeURIComponent(this.desiredPairCode)}` : ''
    const url = `${proto}//${window.location.host}/ws/lan${query}`

    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      this.callbacks.onConnectionChange('offline')
      this.scheduleReconnect()
      return
    }

    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.onopen = () => {
      this.reconnectAttempt = 0
      this.callbacks.onConnectionChange('online')
      const dev = detectLocalDevice()
      this.sendWsJson({
        type: 'hello',
        ...dev,
        customName: this.customName || undefined,
      })
    }

    ws.onmessage = (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        this.handleBinaryRelayFrame(evt.data)
        return
      }
      if (typeof evt.data === 'string') {
        try {
          const msg = JSON.parse(evt.data) as Record<string, unknown>
          this.handleWsJson(msg)
        } catch {
          // 忽略畸形 JSON
        }
      }
    }

    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null
      }
      if (!this.disposed) {
        this.callbacks.onConnectionChange('offline')
        this.scheduleReconnect()
      }
    }

    ws.onerror = () => {
      // onclose 会紧接着触发重连
    }
  }

  public destroy() {
    this.disposed = true
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.outgoing.forEach((s) => this.cleanupOutgoing(s))
    this.incoming.forEach((s) => this.cleanupIncoming(s))
    this.outgoing.clear()
    this.incoming.clear()
    this.cleanupWs()
  }

  public rename(name: string) {
    const clean = name.trim().slice(0, 18)
    if (!clean) return
    this.customName = clean
    this.sendWsJson({ type: 'rename', name: clean })
  }

  public joinPairRoom(code: string | null) {
    const clean = code ? code.replace(/\D/g, '').slice(0, 6) : ''
    this.desiredPairCode = clean.length === 6 ? clean : null
    this.sendWsJson({ type: 'join-room', room: this.desiredPairCode })
  }

  public sendText(peerId: string, text: string): boolean {
    const trimmed = text.trim()
    if (!trimmed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    const id = uid()
    this.sendWsJson({ type: 'text-message', to: peerId, id, text: trimmed })
    return true
  }

  /** 向指定设备发送一个或多个文件（优先 WebRTC P2P，4.5s 内建连失败自动切换服务端内存流兜底） */
  public async sendFiles(peerId: string, files: File[]) {
    if (!files.length) return
    const peer = this.peers.get(peerId)
    if (!peer) {
      this.callbacks.onToast('error', '目标设备已离线')
      return
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.callbacks.onToast('error', '无线信令尚未连接，请稍后重试')
      return
    }

    const transferId = uid()
    const descriptors: FileDescriptor[] = files.map((f) => ({
      id: uid(),
      name: f.name,
      size: f.size,
      type: f.type || 'application/octet-stream',
    }))
    const totalSize = files.reduce((s, f) => s + f.size, 0)

    const session: OutgoingSession = {
      transferId,
      peerId,
      peerName: peer.name,
      files,
      descriptors,
      totalSize,
      transport: 'p2p',
      cancelled: false,
      startedStreaming: false,
    }
    this.outgoing.set(transferId, session)

    this.emitTransfer(session, 'connecting', 0, 0, descriptors[0]?.name ?? '')

    // 若浏览器不支持 WebRTC，直接走内存流中转兜底
    if (typeof RTCPeerConnection === 'undefined') {
      void this.fallbackToRelay(session, '当前浏览器不支持 WebRTC，已自动切换中转通道')
      return
    }

    try {
      const pc = new RTCPeerConnection(RTC_CONFIG)
      session.pc = pc
      const dc = pc.createDataChannel('litebox-file', { ordered: true })
      dc.binaryType = 'arraybuffer'
      dc.bufferedAmountLowThreshold = P2P_HIGH_WATERMARK / 2
      session.dc = dc

      pc.onicecandidate = (e) => {
        if (e.candidate && !session.cancelled && session.transport === 'p2p') {
          this.sendWsJson({
            type: 'signal',
            to: peerId,
            data: { kind: 'ice', transferId, candidate: e.candidate.toJSON() },
          })
        }
      }

      pc.onconnectionstatechange = () => {
        if (session.cancelled || session.transport !== 'p2p') return
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          if (!session.startedStreaming) {
            void this.fallbackToRelay(session, 'P2P 通道受限，已自动切换中转兜底')
          } else {
            this.emitTransfer(session, 'error', 0, 0, '', 'P2P 连接意外中断')
            this.cleanupOutgoing(session)
          }
        }
      }

      dc.onopen = () => {
        if (session.cancelled || session.transport !== 'p2p') return
        if (session.watchdog) {
          window.clearTimeout(session.watchdog)
          session.watchdog = undefined
        }
        // 发送文件元数据并等待对方确认
        dc.send(JSON.stringify({ kind: 'offer', transferId, files: descriptors, totalSize }))
        this.emitTransfer(session, 'waiting-accept', 0, 0, descriptors[0]?.name ?? '')
      }

      dc.onmessage = (evt) => {
        if (typeof evt.data !== 'string' || session.cancelled) return
        try {
          const msg = JSON.parse(evt.data) as { kind: string }
          if (msg.kind === 'accept' && !session.startedStreaming) {
            session.startedStreaming = true
            void this.streamFilesViaP2P(session)
          } else if (msg.kind === 'reject') {
            this.emitTransfer(session, 'rejected', 0, 0, '')
            this.callbacks.onToast('info', `${session.peerName} 拒绝了文件传输`)
            this.cleanupOutgoing(session)
          } else if (msg.kind === 'cancel') {
            session.cancelled = true
            this.emitTransfer(session, 'cancelled', 0, 0, '')
            this.cleanupOutgoing(session)
          }
        } catch {
          // 忽略
        }
      }

      dc.onerror = () => {
        if (!session.startedStreaming && session.transport === 'p2p' && !session.cancelled) {
          void this.fallbackToRelay(session, 'P2P 数据通道异常，已自动切换中转兜底')
        }
      }

      // 4.5 秒 P2P 建连看门狗：超时即无感回退至服务端内存流兜底
      session.watchdog = window.setTimeout(() => {
        if (!session.cancelled && session.transport === 'p2p' && dc.readyState !== 'open') {
          void this.fallbackToRelay(session, '局域网直连超时，已自动启用中转兜底通道')
        }
      }, P2P_CONNECT_TIMEOUT_MS)

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this.sendWsJson({
        type: 'signal',
        to: peerId,
        data: { kind: 'offer', transferId, sdp: pc.localDescription },
      })
    } catch {
      void this.fallbackToRelay(session, 'P2P 初始化失败，已自动切换中转兜底')
    }
  }

  /** 接收方点击“接收”或“拒绝” */
  public respondOffer(transferId: string, accept: boolean) {
    const session = this.incoming.get(transferId)
    if (!session) return

    if (!accept) {
      session.cancelled = true
      if (session.transport === 'p2p' && session.dc?.readyState === 'open') {
        session.dc.send(JSON.stringify({ kind: 'reject' }))
      } else {
        this.sendWsJson({
          type: 'relay-control',
          to: session.peerId,
          payload: { kind: 'reject', transferId },
        })
      }
      this.emitIncomingTransfer(session, 'rejected')
      this.cleanupIncoming(session)
      return
    }

    session.accepted = true
    session.lastSpeedTs = performance.now()
    session.lastSpeedBytes = 0
    this.emitIncomingTransfer(session, 'transferring')

    if (session.transport === 'p2p' && session.dc?.readyState === 'open') {
      session.dc.send(JSON.stringify({ kind: 'accept' }))
    } else {
      this.sendWsJson({
        type: 'relay-control',
        to: session.peerId,
        payload: { kind: 'accept', transferId },
      })
    }
  }

  /** 取消正在进行的发送或接收 */
  public cancelTransfer(transferId: string) {
    const out = this.outgoing.get(transferId)
    if (out) {
      out.cancelled = true
      out.acceptResolver?.(false)
      if (out.transport === 'p2p' && out.dc?.readyState === 'open') {
        out.dc.send(JSON.stringify({ kind: 'cancel' }))
      } else {
        this.sendWsJson({
          type: 'relay-control',
          to: out.peerId,
          payload: { kind: 'cancel', transferId },
        })
      }
      this.emitTransfer(out, 'cancelled', 0, 0, '')
      this.cleanupOutgoing(out)
      return
    }

    const inc = this.incoming.get(transferId)
    if (inc) {
      inc.cancelled = true
      if (inc.transport === 'p2p' && inc.dc?.readyState === 'open') {
        inc.dc.send(JSON.stringify({ kind: 'cancel' }))
      } else {
        this.sendWsJson({
          type: 'relay-control',
          to: inc.peerId,
          payload: { kind: 'cancel', transferId },
        })
      }
      this.emitIncomingTransfer(inc, 'cancelled')
      this.cleanupIncoming(inc)
    }
  }

  /** 无感切换至服务端纯内存流中转兜底 */
  private async fallbackToRelay(session: OutgoingSession, reason: string) {
    if (session.cancelled || session.transport === 'relay') return
    if (session.watchdog) {
      window.clearTimeout(session.watchdog)
      session.watchdog = undefined
    }
    try {
      session.dc?.close()
      session.pc?.close()
    } catch {
      // 忽略关闭异常
    }
    session.dc = undefined
    session.pc = undefined
    session.transport = 'relay'

    this.callbacks.onToast('info', reason)
    this.emitTransfer(session, 'waiting-accept', 0, 0, session.descriptors[0]?.name ?? '')

    // 发送中转握手 Offer 并等待接收方响应
    this.sendWsJson({
      type: 'relay-control',
      to: session.peerId,
      payload: {
        kind: 'offer',
        transferId: session.transferId,
        files: session.descriptors,
        totalSize: session.totalSize,
      },
    })

    const accepted = await new Promise<boolean>((resolve) => {
      session.acceptResolver = resolve
    })
    session.acceptResolver = undefined

    if (!accepted || session.cancelled) return
    session.startedStreaming = true
    await this.streamFilesViaRelay(session)
  }

  /** WebRTC P2P 分片流式发送（带背压等待，轻松传输大文件） */
  private async streamFilesViaP2P(session: OutgoingSession) {
    const dc = session.dc
    if (!dc) return

    let sentBytes = 0
    let lastTs = performance.now()
    let lastBytes = 0
    let speedBps = 0

    const waitBufferDrain = () =>
      new Promise<void>((resolve) => {
        if (dc.bufferedAmount <= P2P_HIGH_WATERMARK || session.cancelled || dc.readyState !== 'open') {
          resolve()
          return
        }
        const onLow = () => {
          dc.removeEventListener('bufferedamountlow', onLow)
          resolve()
        }
        dc.addEventListener('bufferedamountlow', onLow)
      })

    try {
      for (let i = 0; i < session.files.length; i++) {
        if (session.cancelled) return
        const file = session.files[i]
        dc.send(JSON.stringify({ kind: 'file-start', fileIndex: i }))

        let offset = 0
        while (offset < file.size) {
          if (session.cancelled || dc.readyState !== 'open') return
          if (dc.bufferedAmount > P2P_HIGH_WATERMARK) {
            await waitBufferDrain()
          }
          const slice = file.slice(offset, offset + P2P_CHUNK_SIZE)
          const buf = await slice.arrayBuffer()
          dc.send(buf)
          offset += buf.byteLength
          sentBytes += buf.byteLength

          const now = performance.now()
          if (now - lastTs >= 180 || sentBytes >= session.totalSize) {
            speedBps = ((sentBytes - lastBytes) * 1000) / Math.max(1, now - lastTs)
            lastTs = now
            lastBytes = sentBytes
            this.emitTransfer(session, 'transferring', sentBytes, speedBps, file.name)
          }
        }

        dc.send(JSON.stringify({ kind: 'file-end', fileIndex: i }))
      }

      dc.send(JSON.stringify({ kind: 'done' }))
      this.emitTransfer(session, 'done', session.totalSize, speedBps, '')
      this.callbacks.onToast('success', `已通过局域网直连发送给 ${session.peerName}`)
      // 延迟 1.5s 释放通道确保尾帧送达
      window.setTimeout(() => this.cleanupOutgoing(session), 1500)
    } catch {
      if (!session.cancelled) {
        this.emitTransfer(session, 'error', sentBytes, 0, '', '发送过程发生异常')
        this.cleanupOutgoing(session)
      }
    }
  }

  /** 极端网络兜底：通过 WebSocket 二进制分片纯内存透传 */
  private async streamFilesViaRelay(session: OutgoingSession) {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.emitTransfer(session, 'error', 0, 0, '', '信令通道已断开')
      this.cleanupOutgoing(session)
      return
    }

    let sentBytes = 0
    let lastTs = performance.now()
    let lastBytes = 0
    let speedBps = 0

    const waitWsDrain = async () => {
      while (ws.bufferedAmount > RELAY_HIGH_WATERMARK && !session.cancelled && ws.readyState === WebSocket.OPEN) {
        await new Promise((r) => window.setTimeout(r, 15))
      }
    }

    try {
      for (let i = 0; i < session.files.length; i++) {
        if (session.cancelled) return
        const file = session.files[i]
        this.sendWsJson({
          type: 'relay-control',
          to: session.peerId,
          payload: { kind: 'file-start', transferId: session.transferId, fileIndex: i },
        })

        let offset = 0
        while (offset < file.size) {
          if (session.cancelled || ws.readyState !== WebSocket.OPEN) return
          if (ws.bufferedAmount > RELAY_HIGH_WATERMARK) {
            await waitWsDrain()
          }
          const slice = file.slice(offset, offset + RELAY_CHUNK_SIZE)
          const buf = new Uint8Array(await slice.arrayBuffer())
          ws.send(encodeRelayFrame(session.peerId, session.transferId, buf))
          offset += buf.byteLength
          sentBytes += buf.byteLength

          const now = performance.now()
          if (now - lastTs >= 180 || sentBytes >= session.totalSize) {
            speedBps = ((sentBytes - lastBytes) * 1000) / Math.max(1, now - lastTs)
            lastTs = now
            lastBytes = sentBytes
            this.emitTransfer(session, 'transferring', sentBytes, speedBps, file.name)
          }
        }

        this.sendWsJson({
          type: 'relay-control',
          to: session.peerId,
          payload: { kind: 'file-end', transferId: session.transferId, fileIndex: i },
        })
      }

      this.sendWsJson({
        type: 'relay-control',
        to: session.peerId,
        payload: { kind: 'done', transferId: session.transferId },
      })
      this.emitTransfer(session, 'done', session.totalSize, speedBps, '')
      this.callbacks.onToast('success', `已通过中转兜底通道发送给 ${session.peerName}`)
      this.cleanupOutgoing(session)
    } catch {
      if (!session.cancelled) {
        this.emitTransfer(session, 'error', sentBytes, 0, '', '中转发送失败')
        this.cleanupOutgoing(session)
      }
    }
  }

  /** 处理服务端发来的 JSON 消息 */
  private handleWsJson(msg: Record<string, unknown>) {
    switch (msg.type) {
      case 'welcome': {
        const self = msg.self as PeerInfo
        const peers = (msg.peers as PeerInfo[]) ?? []
        this.peers.clear()
        peers.forEach((p) => this.peers.set(p.id, p))
        this.callbacks.onWelcome({
          self,
          peers,
          roomLabel: String(msg.roomLabel ?? '同局域网自动发现'),
          pairCode: (msg.pairCode as string | null) ?? null,
        })
        break
      }
      case 'self-updated':
        this.callbacks.onSelfUpdated(msg.self as PeerInfo)
        break
      case 'peer-joined': {
        const peer = msg.peer as PeerInfo
        this.peers.set(peer.id, peer)
        this.callbacks.onPeerJoined(peer)
        break
      }
      case 'peer-left': {
        const peerId = String(msg.peerId)
        this.peers.delete(peerId)
        this.callbacks.onPeerLeft(peerId)
        break
      }
      case 'peer-updated': {
        const peer = msg.peer as PeerInfo
        this.peers.set(peer.id, peer)
        this.callbacks.onPeerUpdated(peer)
        break
      }
      case 'text-message': {
        const item: TextMessageItem = {
          id: String(msg.id ?? uid()),
          peerId: String(msg.from),
          peerName: String(msg.fromName ?? '未知设备'),
          direction: 'in',
          text: String(msg.text ?? ''),
          time: formatShortTime(),
        }
        this.callbacks.onTextReceived(item)
        break
      }
      case 'signal':
        void this.handleRtcSignal(String(msg.from), msg.data as Record<string, unknown>)
        break
      case 'relay-control':
        this.handleRelayControl(String(msg.from), msg.payload as Record<string, unknown>)
        break
    }
  }

  /** 处理 WebRTC SDP / ICE 握手信令 */
  private async handleRtcSignal(fromId: string, data: Record<string, unknown>) {
    const transferId = String(data.transferId ?? '')
    if (!transferId) return

    if (data.kind === 'offer') {
      if (typeof RTCPeerConnection === 'undefined') return
      const peer = this.peers.get(fromId)
      const pc = new RTCPeerConnection(RTC_CONFIG)

      const session: IncomingSession = {
        transferId,
        peerId: fromId,
        peerName: peer?.name ?? '附近设备',
        transport: 'p2p',
        files: [],
        totalSize: 0,
        pc,
        accepted: false,
        cancelled: false,
        currentFileIndex: -1,
        currentChunks: [],
        currentFileReceived: 0,
        totalReceived: 0,
        lastSpeedTs: performance.now(),
        lastSpeedBytes: 0,
        speedBps: 0,
      }
      this.incoming.set(transferId, session)

      pc.onicecandidate = (e) => {
        if (e.candidate && !session.cancelled) {
          this.sendWsJson({
            type: 'signal',
            to: fromId,
            data: { kind: 'ice', transferId, candidate: e.candidate.toJSON() },
          })
        }
      }

      pc.ondatachannel = (evt) => {
        const dc = evt.channel
        dc.binaryType = 'arraybuffer'
        session.dc = dc

        dc.onmessage = (mEvt) => {
          if (session.cancelled) return
          if (typeof mEvt.data === 'string') {
            try {
              const ctrl = JSON.parse(mEvt.data) as Record<string, unknown>
              this.handleIncomingControl(session, ctrl)
            } catch {
              // 忽略
            }
          } else if (mEvt.data instanceof ArrayBuffer) {
            this.handleIncomingChunk(session, new Uint8Array(mEvt.data))
          }
        }
      }

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        this.sendWsJson({
          type: 'signal',
          to: fromId,
          data: { kind: 'answer', transferId, sdp: pc.localDescription },
        })
      } catch {
        this.cleanupIncoming(session)
      }
      return
    }

    if (data.kind === 'answer') {
      const out = this.outgoing.get(transferId)
      if (!out?.pc || out.transport !== 'p2p') return
      try {
        await out.pc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit))
      } catch {
        // 超时看门狗会兜底
      }
      return
    }

    if (data.kind === 'ice') {
      const candidate = new RTCIceCandidate(data.candidate as RTCIceCandidateInit)
      const out = this.outgoing.get(transferId)
      if (out?.pc && out.transport === 'p2p') {
        void out.pc.addIceCandidate(candidate).catch(() => {})
        return
      }
      const inc = this.incoming.get(transferId)
      if (inc?.pc && inc.transport === 'p2p') {
        void inc.pc.addIceCandidate(candidate).catch(() => {})
      }
    }
  }

  /** 处理中转兜底控制信令 */
  private handleRelayControl(fromId: string, payload: Record<string, unknown>) {
    const kind = String(payload.kind ?? '')
    const transferId = String(payload.transferId ?? '')
    if (!transferId) return

    // 发送端收到的控制响应
    const out = this.outgoing.get(transferId)
    if (out && out.peerId === fromId) {
      if (kind === 'accept') {
        out.acceptResolver?.(true)
      } else if (kind === 'reject') {
        out.cancelled = true
        out.acceptResolver?.(false)
        this.emitTransfer(out, 'rejected', 0, 0, '')
        this.callbacks.onToast('info', `${out.peerName} 拒绝了文件传输`)
        this.cleanupOutgoing(out)
      } else if (kind === 'cancel') {
        out.cancelled = true
        out.acceptResolver?.(false)
        this.emitTransfer(out, 'cancelled', 0, 0, '')
        this.cleanupOutgoing(out)
      }
      return
    }

    // 接收端收到新中转请求
    if (kind === 'offer') {
      // 如果之前同 transferId 曾尝试过 P2P 建连，平滑替换为中转会话
      const stale = this.incoming.get(transferId)
      if (stale) this.cleanupIncoming(stale)

      const peer = this.peers.get(fromId)
      const session: IncomingSession = {
        transferId,
        peerId: fromId,
        peerName: peer?.name ?? '附近设备',
        transport: 'relay',
        files: [],
        totalSize: 0,
        accepted: false,
        cancelled: false,
        currentFileIndex: -1,
        currentChunks: [],
        currentFileReceived: 0,
        totalReceived: 0,
        lastSpeedTs: performance.now(),
        lastSpeedBytes: 0,
        speedBps: 0,
      }
      this.incoming.set(transferId, session)
      this.handleIncomingControl(session, payload)
      return
    }

    const inc = this.incoming.get(transferId)
    if (inc && inc.peerId === fromId) {
      this.handleIncomingControl(inc, payload)
    }
  }

  /** 处理接收端统一控制帧（P2P 与中转兜底完全复用同一套接收状态机） */
  private handleIncomingControl(session: IncomingSession, ctrl: Record<string, unknown>) {
    const kind = String(ctrl.kind ?? '')
    if (kind === 'offer') {
      session.files = (ctrl.files as FileDescriptor[]) ?? []
      session.totalSize = Number(ctrl.totalSize ?? 0)
      const peer = this.peers.get(session.peerId)

      if (this.autoAccept) {
        this.respondOffer(session.transferId, true)
      } else {
        this.emitIncomingTransfer(session, 'waiting-accept')
        this.callbacks.onIncomingOffer({
          transferId: session.transferId,
          fromId: session.peerId,
          fromName: peer?.name ?? session.peerName,
          fromColor: peer?.color ?? '#06b6d4',
          transport: session.transport,
          files: session.files,
          totalSize: session.totalSize,
        })
      }
    } else if (kind === 'file-start') {
      session.currentFileIndex = Number(ctrl.fileIndex ?? 0)
      session.currentChunks = []
      session.currentFileReceived = 0
    } else if (kind === 'file-end') {
      const idx = Number(ctrl.fileIndex ?? session.currentFileIndex)
      const desc = session.files[idx]
      if (desc) {
        const blob = new Blob(session.currentChunks as BlobPart[], { type: desc.type || 'application/octet-stream' })
        const url = URL.createObjectURL(blob)
        downloadBlob(blob, desc.name)
        this.callbacks.onFileReceived({
          id: uid(),
          fromName: session.peerName,
          name: desc.name,
          size: blob.size,
          type: desc.type,
          url,
          isImage: desc.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(desc.name),
          time: formatShortTime(),
          transport: session.transport,
        })
      }
      session.currentChunks = []
    } else if (kind === 'done') {
      session.totalReceived = session.totalSize
      this.emitIncomingTransfer(session, 'done')
      this.callbacks.onToast('success', `已接收来自 ${session.peerName} 的 ${session.files.length} 个文件`)
      this.cleanupIncoming(session)
    } else if (kind === 'cancel') {
      session.cancelled = true
      this.emitIncomingTransfer(session, 'cancelled')
      this.callbacks.onToast('info', `${session.peerName} 取消了传输`)
      this.cleanupIncoming(session)
    }
  }

  /** 处理二进制中转分片 */
  private handleBinaryRelayFrame(buffer: ArrayBuffer) {
    const decoded = decodeRelayFrame(buffer)
    if (!decoded) return
    const session = this.incoming.get(decoded.transferId)
    if (!session || session.peerId !== decoded.senderId || session.cancelled) return
    this.handleIncomingChunk(session, decoded.chunk)
  }

  /** 累加接收分片并更新实时速率 */
  private handleIncomingChunk(session: IncomingSession, chunk: Uint8Array) {
    if (!session.accepted || session.cancelled) return
    session.currentChunks.push(chunk)
    session.currentFileReceived += chunk.byteLength
    session.totalReceived += chunk.byteLength

    const now = performance.now()
    if (now - session.lastSpeedTs >= 180 || session.totalReceived >= session.totalSize) {
      session.speedBps = ((session.totalReceived - session.lastSpeedBytes) * 1000) / Math.max(1, now - session.lastSpeedTs)
      session.lastSpeedTs = now
      session.lastSpeedBytes = session.totalReceived
      this.emitIncomingTransfer(session, 'transferring')
    }
  }

  private emitTransfer(
    session: OutgoingSession,
    status: ActiveTransfer['status'],
    transferredBytes: number,
    speedBps: number,
    currentFileName: string,
    error?: string,
  ) {
    this.callbacks.onTransferUpdate({
      transferId: session.transferId,
      peerId: session.peerId,
      peerName: session.peerName,
      direction: 'send',
      transport: session.transport,
      files: session.descriptors,
      totalSize: session.totalSize,
      transferredBytes,
      speedBps,
      status,
      currentFileName,
      error,
    })
  }

  private emitIncomingTransfer(session: IncomingSession, status: ActiveTransfer['status']) {
    const curFile = session.files[session.currentFileIndex]?.name ?? session.files[0]?.name ?? ''
    this.callbacks.onTransferUpdate({
      transferId: session.transferId,
      peerId: session.peerId,
      peerName: session.peerName,
      direction: 'recv',
      transport: session.transport,
      files: session.files,
      totalSize: session.totalSize,
      transferredBytes: session.totalReceived,
      speedBps: session.speedBps,
      status,
      currentFileName: curFile,
    })
  }

  private cleanupOutgoing(session: OutgoingSession) {
    if (session.watchdog) window.clearTimeout(session.watchdog)
    try {
      session.dc?.close()
      session.pc?.close()
    } catch {
      // 忽略
    }
    this.outgoing.delete(session.transferId)
  }

  private cleanupIncoming(session: IncomingSession) {
    try {
      session.dc?.close()
      session.pc?.close()
    } catch {
      // 忽略
    }
    this.incoming.delete(session.transferId)
  }

  private sendWsJson(obj: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj))
    }
  }

  private cleanupWs() {
    if (!this.ws) return
    try {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.close()
    } catch {
      // 忽略
    }
    this.ws = null
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer !== null) return
    const delay = Math.min(8000, 1500 * Math.pow(1.4, this.reconnectAttempt))
    this.reconnectAttempt += 1
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }
}

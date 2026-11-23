/**
 * 局域网无线投屏核心引擎
 * - 复用独立后端 /ws/lan?channel=screen 实现同局域网自动发现与 6 位配对码跨网连接
 * - 支持「一投多」并发投屏：推流端为每个观看端独立维护一条 WebRTC 加密连接
 * - 支持定向邀请指定设备观看、画质/码率优化（contentHint + maxBitrate）、实时链路遥测（分辨率/帧率/码率/RTT）
 */

import { detectLocalDevice } from '../lan-transfer/types'
import {
  QUALITY_PRESETS,
  type ConnectionState,
  type QualityPresetId,
  type ScreenInvite,
  type ScreenPeer,
  type StreamMetrics,
} from './types'

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.qq.com:3478' },
  ],
}

export interface ScreenClientCallbacks {
  onConnectionChange: (state: ConnectionState) => void
  onWelcome: (payload: { self: ScreenPeer; peers: ScreenPeer[]; roomLabel: string; pairCode: string | null }) => void
  onSelfUpdated: (self: ScreenPeer) => void
  onPeerJoined: (peer: ScreenPeer) => void
  onPeerLeft: (peerId: string) => void
  onPeerUpdated: (peer: ScreenPeer) => void
  onLocalStreamChange: (stream: MediaStream | null) => void
  onViewersChange: (viewerIds: string[]) => void
  onRemoteStreamChange: (payload: { stream: MediaStream | null; host: ScreenPeer | null; state: 'idle' | 'connecting' | 'playing' }) => void
  onInviteReceived: (invite: ScreenInvite) => void
  onMetricsUpdate: (metrics: StreamMetrics | null) => void
  onToast: (type: 'info' | 'success' | 'error', message: string) => void
}

export class LanScreenClient {
  private ws: WebSocket | null = null
  private callbacks: ScreenClientCallbacks
  private disposed = false
  private reconnectTimer: number | null = null
  private reconnectAttempt = 0
  private customName = ''
  private desiredPairCode: string | null = null

  private peers = new Map<string, ScreenPeer>()
  private selfInfo: ScreenPeer | null = null

  /** 推流端状态 */
  private localStream: MediaStream | null = null
  private castTitle = ''
  private qualityId: QualityPresetId = '1080p30'
  private viewerPcs = new Map<string, RTCPeerConnection>()

  /** 观看端状态 */
  private watchingHostId: string | null = null
  private viewerPc: RTCPeerConnection | null = null
  private remoteStream: MediaStream | null = null
  private statsTimer: number | null = null
  private prevStatsBytes = 0
  private prevStatsTs = 0

  constructor(callbacks: ScreenClientCallbacks, options?: { customName?: string; initialPairCode?: string | null }) {
    this.callbacks = callbacks
    this.customName = options?.customName ?? ''
    this.desiredPairCode = options?.initialPairCode ?? null
  }

  public connect() {
    if (this.disposed) return
    this.cleanupWs()
    this.callbacks.onConnectionChange('connecting')

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const params = new URLSearchParams({ channel: 'screen' })
    if (this.desiredPairCode) params.set('room', this.desiredPairCode)
    const url = `${proto}//${window.location.host}/ws/lan?${params.toString()}`

    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      this.callbacks.onConnectionChange('offline')
      this.scheduleReconnect()
      return
    }

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
      // 若断线重连时正在投屏，自动重新广播投屏状态
      if (this.localStream) {
        this.sendWsJson({ type: 'set-status', casting: true, castTitle: this.castTitle })
      }
    }

    ws.onmessage = (evt) => {
      if (typeof evt.data !== 'string') return
      try {
        const msg = JSON.parse(evt.data) as Record<string, unknown>
        this.handleWsJson(msg)
      } catch {
        // 忽略畸形 JSON
      }
    }

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null
      if (!this.disposed) {
        this.callbacks.onConnectionChange('offline')
        this.scheduleReconnect()
      }
    }

    ws.onerror = () => {
      // onclose 会处理重连
    }
  }

  public destroy() {
    this.disposed = true
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopCasting(true)
    this.stopWatching(true)
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
    this.stopWatching()
    this.closeAllViewerPcs()
    this.sendWsJson({ type: 'join-room', room: this.desiredPairCode })
    if (this.localStream) {
      window.setTimeout(() => {
        this.sendWsJson({ type: 'set-status', casting: true, castTitle: this.castTitle })
      }, 120)
    }
  }

  /** 开始采集屏幕并开启投屏（可同时投给多台设备） */
  public async startCasting(options: { quality: QualityPresetId; includeAudio: boolean; title: string }): Promise<boolean> {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      this.callbacks.onToast('error', '当前环境不支持发起投屏（需在桌面浏览器通过 localhost 或 HTTPS 访问）')
      return false
    }

    // 开始推流前若正在观看别人，先退出观看
    this.stopWatching()
    this.stopCasting(true)

    const preset = QUALITY_PRESETS.find((p) => p.id === options.quality) ?? QUALITY_PRESETS[0]
    this.qualityId = preset.id
    this.castTitle = options.title.trim()

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: preset.width, max: preset.width },
          height: { ideal: preset.height, max: preset.height },
          frameRate: { ideal: preset.fps, max: preset.fps },
        },
        audio: options.includeAudio
          ? {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            }
          : false,
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        this.callbacks.onToast('info', '已取消选择共享屏幕')
      } else {
        this.callbacks.onToast('error', '无法捕获屏幕，请检查系统屏幕录制权限')
      }
      return false
    }

    const videoTrack = stream.getVideoTracks()[0]
    if (videoTrack) {
      // 提示编码器优先文字锐利度或动态流畅度
      if ('contentHint' in videoTrack) {
        try {
          videoTrack.contentHint = preset.contentHint
        } catch {
          // 忽略不支持的浏览器
        }
      }
      // 监听用户在浏览器系统浮条点击“停止共享”
      videoTrack.addEventListener('ended', () => {
        this.stopCasting()
        this.callbacks.onToast('info', '屏幕共享已结束')
      })
    }

    this.localStream = stream
    this.callbacks.onLocalStreamChange(stream)
    this.sendWsJson({ type: 'set-status', casting: true, castTitle: this.castTitle })
    this.callbacks.onToast('success', '无线投屏已就绪，同局域网设备可直接点击观看，也可点设备发起定向邀请')
    return true
  }

  /** 向某台在线设备定向发送投屏观看邀请 */
  public invitePeer(peerId: string) {
    if (!this.localStream) {
      this.callbacks.onToast('error', '请先点击「开始共享屏幕」')
      return
    }
    const peer = this.peers.get(peerId)
    if (!peer) {
      this.callbacks.onToast('error', '目标设备已离线')
      return
    }
    this.sendWsJson({
      type: 'signal',
      to: peerId,
      data: {
        kind: 'screen-invite',
        castTitle: this.castTitle || `${this.selfInfo?.name ?? '附近设备'} 的屏幕`,
      },
    })
    this.callbacks.onToast('success', `已向「${peer.name}」发出无线投屏邀请`)
  }

  /** 断开指定观看端 */
  public kickViewer(viewerId: string) {
    const pc = this.viewerPcs.get(viewerId)
    if (pc) {
      try {
        pc.close()
      } catch {
        // 忽略
      }
      this.viewerPcs.delete(viewerId)
      this.sendWsJson({ type: 'signal', to: viewerId, data: { kind: 'screen-ended' } })
      this.emitViewers()
    }
  }

  /** 停止投屏 */
  public stopCasting(silent = false) {
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop())
      this.localStream = null
    }
    for (const viewerId of this.viewerPcs.keys()) {
      this.sendWsJson({ type: 'signal', to: viewerId, data: { kind: 'screen-ended' } })
    }
    this.closeAllViewerPcs()
    if (!silent) {
      this.sendWsJson({ type: 'set-status', casting: false, castTitle: '' })
      this.callbacks.onLocalStreamChange(null)
    }
  }

  /** 作为观看端请求连接某台正在投屏的设备 */
  public watchPeer(hostId: string) {
    const host = this.peers.get(hostId)
    if (!host) {
      this.callbacks.onToast('error', '该设备已离线')
      return
    }
    if (typeof RTCPeerConnection === 'undefined') {
      this.callbacks.onToast('error', '当前浏览器不支持 WebRTC 投屏播放')
      return
    }

    this.stopWatching(true)
    this.watchingHostId = hostId
    this.callbacks.onRemoteStreamChange({ stream: null, host, state: 'connecting' })
    this.sendWsJson({
      type: 'signal',
      to: hostId,
      data: { kind: 'screen-watch' },
    })
  }

  /** 退出观看 */
  public stopWatching(silent = false) {
    this.stopMetricsLoop()
    const prevHost = this.watchingHostId
    this.watchingHostId = null
    if (prevHost && !silent) {
      this.sendWsJson({ type: 'signal', to: prevHost, data: { kind: 'screen-leave' } })
    }
    if (this.viewerPc) {
      try {
        this.viewerPc.close()
      } catch {
        // 忽略
      }
      this.viewerPc = null
    }
    this.remoteStream = null
    if (!silent) {
      this.callbacks.onRemoteStreamChange({ stream: null, host: null, state: 'idle' })
      this.callbacks.onMetricsUpdate(null)
    }
  }

  /** 推流端为某个观看者创建专属 RTCPeerConnection 并推流 */
  private async createOfferForViewer(viewerId: string) {
    if (!this.localStream || typeof RTCPeerConnection === 'undefined') return

    // 若该观看者已有旧连接，先清理
    const oldPc = this.viewerPcs.get(viewerId)
    if (oldPc) {
      try {
        oldPc.close()
      } catch {
        // 忽略
      }
      this.viewerPcs.delete(viewerId)
    }

    const pc = new RTCPeerConnection(RTC_CONFIG)
    this.viewerPcs.set(viewerId, pc)
    this.emitViewers()

    const preset = QUALITY_PRESETS.find((p) => p.id === this.qualityId) ?? QUALITY_PRESETS[0]

    for (const track of this.localStream.getTracks()) {
      const sender = pc.addTrack(track, this.localStream)
      // 为局域网投屏拉高视频码率上限，确保文字锐利不发糊
      if (track.kind === 'video') {
        try {
          const params = sender.getParameters()
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}]
          }
          params.encodings[0].maxBitrate = preset.maxBitrateKbps * 1000
          params.encodings[0].maxFramerate = preset.fps
          await sender.setParameters(params)
        } catch {
          // 部分浏览器忽略自定义码率参数
        }
      }
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendWsJson({
          type: 'signal',
          to: viewerId,
          data: { kind: 'screen-ice', role: 'host', candidate: e.candidate.toJSON() },
        })
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        if (this.viewerPcs.get(viewerId) === pc) {
          this.viewerPcs.delete(viewerId)
          this.emitViewers()
        }
      }
    }

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this.sendWsJson({
        type: 'signal',
        to: viewerId,
        data: { kind: 'screen-offer', sdp: pc.localDescription },
      })
    } catch {
      this.viewerPcs.delete(viewerId)
      this.emitViewers()
    }
  }

  /** 观看端收到推流端的 SDP Offer，建立接收连接 */
  private async handleOfferFromHost(hostId: string, sdp: RTCSessionDescriptionInit) {
    if (this.watchingHostId !== hostId) return
    const host = this.peers.get(hostId) ?? null

    if (this.viewerPc) {
      try {
        this.viewerPc.close()
      } catch {
        // 忽略
      }
    }

    const pc = new RTCPeerConnection(RTC_CONFIG)
    this.viewerPc = pc
    const stream = new MediaStream()
    this.remoteStream = stream

    pc.ontrack = (evt) => {
      if (evt.streams?.[0]) {
        this.remoteStream = evt.streams[0]
      } else {
        stream.addTrack(evt.track)
      }
      this.callbacks.onRemoteStreamChange({
        stream: this.remoteStream,
        host: this.peers.get(hostId) ?? host,
        state: 'playing',
      })
      this.startMetricsLoop(pc)
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendWsJson({
          type: 'signal',
          to: hostId,
          data: { kind: 'screen-ice', role: 'viewer', candidate: e.candidate.toJSON() },
        })
      }
    }

    pc.onconnectionstatechange = () => {
      if (this.viewerPc !== pc) return
      if (pc.connectionState === 'failed') {
        this.callbacks.onToast('error', '无线投屏连接中断，请尝试重新连接')
        this.stopWatching()
      }
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      this.sendWsJson({
        type: 'signal',
        to: hostId,
        data: { kind: 'screen-answer', sdp: pc.localDescription },
      })
    } catch {
      this.callbacks.onToast('error', '建立投屏画面失败')
      this.stopWatching()
    }
  }

  /** 定时采集观看端 WebRTC 实时分辨率、帧率、码率与往返延迟 RTT */
  private startMetricsLoop(pc: RTCPeerConnection) {
    this.stopMetricsLoop()
    this.prevStatsBytes = 0
    this.prevStatsTs = performance.now()

    this.statsTimer = window.setInterval(async () => {
      if (this.viewerPc !== pc || pc.connectionState === 'closed') {
        this.stopMetricsLoop()
        return
      }
      try {
        const stats = await pc.getStats()
        let width = 0
        let height = 0
        let fps = 0
        let bytesReceived = 0
        let rttMs: number | null = null

        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            width = Number(report.frameWidth || 0)
            height = Number(report.frameHeight || 0)
            fps = Math.round(Number(report.framesPerSecond || 0))
            bytesReceived = Number(report.bytesReceived || 0)
          } else if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime != null) {
            rttMs = Math.round(Number(report.currentRoundTripTime) * 1000)
          }
        })

        const now = performance.now()
        const dt = Math.max(200, now - this.prevStatsTs)
        const deltaBytes = Math.max(0, bytesReceived - this.prevStatsBytes)
        const bitrateKbps = this.prevStatsBytes > 0 ? Math.round((deltaBytes * 8) / dt) : 0
        this.prevStatsBytes = bytesReceived
        this.prevStatsTs = now

        this.callbacks.onMetricsUpdate({ width, height, fps, bitrateKbps, rttMs })
      } catch {
        // 忽略统计读取异常
      }
    }, 1200)
  }

  private stopMetricsLoop() {
    if (this.statsTimer !== null) {
      window.clearInterval(this.statsTimer)
      this.statsTimer = null
    }
  }

  private handleWsJson(msg: Record<string, unknown>) {
    switch (msg.type) {
      case 'welcome': {
        const self = msg.self as ScreenPeer
        const peers = (msg.peers as ScreenPeer[]) ?? []
        this.selfInfo = self
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
        this.selfInfo = msg.self as ScreenPeer
        this.callbacks.onSelfUpdated(this.selfInfo)
        break
      case 'peer-joined': {
        const peer = msg.peer as ScreenPeer
        this.peers.set(peer.id, peer)
        this.callbacks.onPeerJoined(peer)
        break
      }
      case 'peer-left': {
        const peerId = String(msg.peerId)
        this.peers.delete(peerId)
        // 如果离开的是观看端，回收其连接
        const vpc = this.viewerPcs.get(peerId)
        if (vpc) {
          try {
            vpc.close()
          } catch {
            // 忽略
          }
          this.viewerPcs.delete(peerId)
          this.emitViewers()
        }
        // 如果离开的是当前正在观看的推流端，优雅退出观看
        if (this.watchingHostId === peerId) {
          this.stopWatching()
          this.callbacks.onToast('info', '投屏发起端已离线')
        }
        this.callbacks.onPeerLeft(peerId)
        break
      }
      case 'peer-updated': {
        const peer = msg.peer as ScreenPeer
        this.peers.set(peer.id, peer)
        this.callbacks.onPeerUpdated(peer)
        break
      }
      case 'signal':
        void this.handleSignal(String(msg.from), msg.data as Record<string, unknown>)
        break
    }
  }

  private async handleSignal(fromId: string, data: Record<string, unknown>) {
    const kind = String(data.kind ?? '')

    if (kind === 'screen-invite') {
      const peer = this.peers.get(fromId)
      this.callbacks.onInviteReceived({
        fromId,
        fromName: peer?.name ?? '附近设备',
        fromColor: peer?.color ?? '#06b6d4',
        castTitle: String(data.castTitle ?? '无线屏幕共享'),
      })
      return
    }

    if (kind === 'screen-watch') {
      if (this.localStream) {
        await this.createOfferForViewer(fromId)
      } else {
        this.sendWsJson({ type: 'signal', to: fromId, data: { kind: 'screen-ended' } })
      }
      return
    }

    if (kind === 'screen-leave') {
      const pc = this.viewerPcs.get(fromId)
      if (pc) {
        try {
          pc.close()
        } catch {
          // 忽略
        }
        this.viewerPcs.delete(fromId)
        this.emitViewers()
      }
      return
    }

    if (kind === 'screen-ended') {
      if (this.watchingHostId === fromId) {
        this.stopWatching()
        this.callbacks.onToast('info', '对方已结束无线投屏')
      }
      return
    }

    if (kind === 'screen-offer') {
      await this.handleOfferFromHost(fromId, data.sdp as RTCSessionDescriptionInit)
      return
    }

    if (kind === 'screen-answer') {
      const pc = this.viewerPcs.get(fromId)
      if (!pc) return
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit))
      } catch {
        // 忽略
      }
      return
    }

    if (kind === 'screen-ice') {
      const candidate = new RTCIceCandidate(data.candidate as RTCIceCandidateInit)
      if (data.role === 'viewer') {
        const pc = this.viewerPcs.get(fromId)
        if (pc) void pc.addIceCandidate(candidate).catch(() => {})
      } else if (data.role === 'host' && this.watchingHostId === fromId && this.viewerPc) {
        void this.viewerPc.addIceCandidate(candidate).catch(() => {})
      }
    }
  }

  private closeAllViewerPcs() {
    this.viewerPcs.forEach((pc) => {
      try {
        pc.close()
      } catch {
        // 忽略
      }
    })
    this.viewerPcs.clear()
    this.emitViewers()
  }

  private emitViewers() {
    this.callbacks.onViewersChange(Array.from(this.viewerPcs.keys()))
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

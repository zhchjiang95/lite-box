/**
 * 轻匣（LiteBox）局域网互联信令与内存流兜底中转模块（零第三方依赖）
 *
 * 原理：
 * 1. 基于 Node.js 原生 HTTP Upgrade 实现标准 RFC 6455 WebSocket 服务端（支持文本帧、二进制帧、分片、Ping/Pong 心跳）
 * 2. 同局域网（同路由器出口公网 IP，或内网/本机私有网段）设备自动进入同一无线发现圈
 * 3. 支持 6 位配对码跨网/防 AP 隔离直连房间
 * 4. 主力文件传输走 WebRTC P2P 直连（服务器仅转发几百字节握手信令）
 * 5. 极端网络兜底：当 WebRTC 建连失败时，透传二进制分片帧（纯内存转发，绝不落盘）
 */

import crypto from 'node:crypto'

const WS_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const MAX_FRAME_PAYLOAD = 2 * 1024 * 1024 // 单帧最大 2 MB 保护
const HEARTBEAT_MS = 25_000

const ADJECTIVES = [
  '星际', '极光', '云端', '量子', '流星', '霓虹', '磁力', '闪电', '银河', '脉冲',
  '微风', '光年', '晨曦', '碧空', '冰川', '琥珀', '琉璃', '翡翠', '星云', '幻影',
]

const NOUNS = [
  '水獭', '企鹅', '考拉', '蓝鲸', '柴犬', '海豚', '熊猫', '松鼠', '橘猫', '火烈鸟',
  '小鹿', '狐狸', '雪鸮', '信天翁', '海豹', '浣熊', '白鸽', '鲸鲨', '刺猬', '长颈鹿',
]

const AVATAR_COLORS = [
  '#8b5cf6', '#06b6d4', '#ec4899', '#10b981', '#f59e0b',
  '#3b82f6', '#f43f5e', '#14b8a6', '#a855f7', '#0ea5e9',
]

/** 判断 IP 是否为内网私有地址或回环地址 */
function isPrivateOrLoopbackIp(ip) {
  if (!ip) return true
  if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.')) return true
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true
  if (ip.startsWith('169.254.') || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) return true
  const m172 = /^172\.(\d+)\./.exec(ip)
  if (m172) {
    const second = Number(m172[1])
    if (second >= 16 && second <= 31) return true
  }
  return false
}

/** 提取并规范化客户端真实 IP（兼容 Nginx / Cloudflare 反代头） */
function extractClientIp(req) {
  const xff = req.headers['x-forwarded-for']
  const raw = Array.isArray(xff)
    ? xff[0]
    : typeof xff === 'string' && xff.trim()
      ? xff.split(',')[0].trim()
      : String(req.headers['x-real-ip'] || req.socket.remoteAddress || '127.0.0.1')

  return raw.replace(/^::ffff:/i, '').trim() || '127.0.0.1'
}

/** 根据客户端 IP 与工具频道计算自动局域网房间键 */
function computeAutoRoomKey(channel, ip) {
  if (isPrivateOrLoopbackIp(ip)) {
    return `${channel}:lan:local`
  }
  return `${channel}:lan:pub:${ip}`
}

/** 编码服务端发往浏览器的 RFC 6455 WebSocket 帧（服务端帧无需掩码） */
function encodeWsFrame(opcode, payloadBuf) {
  const len = payloadBuf.length
  let header
  if (len < 126) {
    header = Buffer.allocUnsafe(2)
    header[0] = 0x80 | opcode
    header[1] = len
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.allocUnsafe(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, payloadBuf])
}

/**
 * 轻量 RFC 6455 WebSocket 连接封装
 */
class MiniWebSocket {
  constructor(socket) {
    this.socket = socket
    this.closed = false
    this.alive = true
    this.recvBuf = Buffer.alloc(0)
    this.fragOpcode = 0
    this.fragChunks = []
    this.onMessage = null
    this.onClose = null

    socket.setNoDelay(true)
    socket.on('data', (chunk) => this._onData(chunk))
    socket.on('close', () => this._handleClose())
    socket.on('error', () => this._handleClose())
  }

  sendJson(obj) {
    if (this.closed || this.socket.destroyed) return
    const payload = Buffer.from(JSON.stringify(obj), 'utf8')
    this.socket.write(encodeWsFrame(0x1, payload))
  }

  sendBinary(buf) {
    if (this.closed || this.socket.destroyed) return
    this.socket.write(encodeWsFrame(0x2, buf))
  }

  ping() {
    if (this.closed || this.socket.destroyed) return
    this.socket.write(encodeWsFrame(0x9, Buffer.alloc(0)))
  }

  close(code = 1000) {
    if (this.closed) return
    this.closed = true
    try {
      const payload = Buffer.alloc(2)
      payload.writeUInt16BE(code, 0)
      this.socket.end(encodeWsFrame(0x8, payload))
    } catch {
      this.socket.destroy()
    }
    this.onClose?.()
  }

  _handleClose() {
    if (this.closed) return
    this.closed = true
    this.onClose?.()
  }

  _onData(chunk) {
    this.alive = true
    this.recvBuf = this.recvBuf.length ? Buffer.concat([this.recvBuf, chunk]) : chunk

    while (this.recvBuf.length >= 2) {
      const b0 = this.recvBuf[0]
      const b1 = this.recvBuf[1]
      const fin = (b0 & 0x80) !== 0
      const opcode = b0 & 0x0f
      const masked = (b1 & 0x80) !== 0
      let payloadLen = b1 & 0x7f
      let offset = 2

      if (payloadLen === 126) {
        if (this.recvBuf.length < 4) return
        payloadLen = this.recvBuf.readUInt16BE(2)
        offset = 4
      } else if (payloadLen === 127) {
        if (this.recvBuf.length < 10) return
        const bigLen = this.recvBuf.readBigUInt64BE(2)
        if (bigLen > BigInt(MAX_FRAME_PAYLOAD)) {
          this.close(1009)
          return
        }
        payloadLen = Number(bigLen)
        offset = 10
      }

      if (payloadLen > MAX_FRAME_PAYLOAD) {
        this.close(1009)
        return
      }

      const maskSize = masked ? 4 : 0
      const frameLen = offset + maskSize + payloadLen
      if (this.recvBuf.length < frameLen) return

      let payload = Buffer.allocUnsafe(payloadLen)
      if (masked) {
        const maskKey = this.recvBuf.subarray(offset, offset + 4)
        const dataStart = offset + 4
        for (let i = 0; i < payloadLen; i++) {
          payload[i] = this.recvBuf[dataStart + i] ^ maskKey[i & 3]
        }
      } else {
        this.recvBuf.copy(payload, 0, offset, offset + payloadLen)
      }

      this.recvBuf = this.recvBuf.subarray(frameLen)

      // 控制帧处理
      if (opcode === 0x8) {
        this.close(1000)
        return
      }
      if (opcode === 0x9) {
        if (!this.closed && !this.socket.destroyed) {
          this.socket.write(encodeWsFrame(0xa, payload))
        }
        continue
      }
      if (opcode === 0xa) {
        this.alive = true
        continue
      }

      // 数据帧（支持分片重组）
      if (opcode === 0x1 || opcode === 0x2) {
        if (fin) {
          this.onMessage?.(opcode === 0x2, payload)
        } else {
          this.fragOpcode = opcode
          this.fragChunks = [payload]
        }
      } else if (opcode === 0x0 && this.fragOpcode) {
        this.fragChunks.push(payload)
        const total = this.fragChunks.reduce((s, b) => s + b.length, 0)
        if (total > MAX_FRAME_PAYLOAD) {
          this.close(1009)
          return
        }
        if (fin) {
          const full = Buffer.concat(this.fragChunks)
          const isBin = this.fragOpcode === 0x2
          this.fragOpcode = 0
          this.fragChunks = []
          this.onMessage?.(isBin, full)
        }
      }
    }
  }
}

/**
 * 将局域网互联信令与内存流中转挂载到现有 HTTP Server
 */
export function attachLanSignaling(httpServer) {
  /** roomKey -> Map<peerId, PeerSession> */
  const rooms = new Map()
  /** roomKey -> Array<ClipItem>（仅存于活跃房间内存中，最后一台设备离开即彻底销毁，绝不落盘） */
  const roomClips = new Map()
  /** 所有活跃连接，便于心跳巡检 */
  const allSessions = new Set()

  const MAX_CLIPS_PER_ROOM = 30
  const MAX_CLIP_IMAGE_LEN = 1_600_000

  const getRoom = (key) => {
    let r = rooms.get(key)
    if (!r) {
      r = new Map()
      rooms.set(key, r)
    }
    return r
  }

  /** 为房间内的新设备生成随机且绝对唯一的有趣代号 */
  const generateUniqueName = (roomKey) => {
    const room = rooms.get(roomKey)
    const used = new Set(room ? Array.from(room.values()).map((s) => s.info.name) : [])

    for (let attempt = 0; attempt < 60; attempt++) {
      const adj = ADJECTIVES[crypto.randomInt(0, ADJECTIVES.length)]
      const noun = NOUNS[crypto.randomInt(0, NOUNS.length)]
      const candidate = `${adj}${noun}`
      if (!used.has(candidate)) return candidate
    }
    return `无线节点-${crypto.randomInt(100, 999)}`
  }

  const broadcastToRoom = (roomKey, payload, excludePeerId = null) => {
    const room = rooms.get(roomKey)
    if (!room) return
    for (const [id, session] of room.entries()) {
      if (id !== excludePeerId) {
        session.ws.sendJson(payload)
      }
    }
  }

  const leaveCurrentRoom = (session) => {
    const room = rooms.get(session.roomKey)
    if (!room) return
    room.delete(session.info.id)
    if (room.size === 0) {
      rooms.delete(session.roomKey)
      // 房间最后一台设备断开时立刻清空内存中的临时剪贴板，做到真正的离开即焚
      roomClips.delete(session.roomKey)
    } else {
      broadcastToRoom(session.roomKey, { type: 'peer-left', peerId: session.info.id })
    }
  }

  const joinRoom = (session, nextRoomKey, pairCode) => {
    if (session.roomKey) {
      leaveCurrentRoom(session)
    }
    session.roomKey = nextRoomKey
    session.pairCode = pairCode

    const room = getRoom(nextRoomKey)
    // 确保名称在目标房间内唯一
    const existingNames = new Set(Array.from(room.values()).map((s) => s.info.name))
    if (!session.info.name || existingNames.has(session.info.name)) {
      session.info.name = generateUniqueName(nextRoomKey)
    }

    const existingPeers = Array.from(room.values()).map((s) => s.info)
    room.set(session.info.id, session)

    session.ws.sendJson({
      type: 'welcome',
      self: session.info,
      pairCode: pairCode || null,
      roomLabel: pairCode ? `配对房间 #${pairCode}` : '同局域网自动发现',
      peers: existingPeers,
      clips: session.channel === 'clipboard' ? (roomClips.get(nextRoomKey) ?? []) : undefined,
    })

    broadcastToRoom(nextRoomKey, { type: 'peer-joined', peer: session.info }, session.info.id)
  }

  // 心跳保活，自动清理静默断线的移动端连接
  const heartbeatTimer = setInterval(() => {
    for (const session of allSessions) {
      if (!session.ws.alive) {
        session.ws.close(1001)
        continue
      }
      session.ws.alive = false
      session.ws.ping()
    }
  }, HEARTBEAT_MS)
  heartbeatTimer.unref()

  httpServer.on('upgrade', (req, socket, head) => {
    const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    if (parsed.pathname !== '/ws/lan') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }

    const wsKey = req.headers['sec-websocket-key']
    if (!wsKey || typeof wsKey !== 'string') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }

    const acceptKey = crypto
      .createHash('sha1')
      .update(wsKey + WS_MAGIC_GUID)
      .digest('base64')

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`,
    )

    const ws = new MiniWebSocket(socket)
    const clientIp = extractClientIp(req)
    const channel = (parsed.searchParams.get('channel') || 'transfer').replace(/[^a-z0-9_-]/gi, '').slice(0, 20) || 'transfer'
    const autoRoomKey = computeAutoRoomKey(channel, clientIp)
    const peerId = crypto.randomBytes(6).toString('hex')
    const color = AVATAR_COLORS[crypto.randomInt(0, AVATAR_COLORS.length)]

    const session = {
      ws,
      channel,
      autoRoomKey,
      roomKey: null,
      pairCode: null,
      info: {
        id: peerId,
        name: generateUniqueName(autoRoomKey),
        deviceType: 'desktop',
        osLabel: '未知设备',
        browserLabel: '浏览器',
        color,
        casting: false,
        castTitle: '',
      },
    }

    allSessions.add(session)

    // 读取 URL 初始配对房间参数（例如扫码/分享链接 ?room=123456）
    const initPair = (parsed.searchParams.get('room') || '').replace(/\D/g, '').slice(0, 6)
    const initialRoomKey = initPair.length === 6 ? `${channel}:pair:${initPair}` : autoRoomKey
    joinRoom(session, initialRoomKey, initPair.length === 6 ? initPair : null)

    ws.onMessage = (isBinary, payload) => {
      // 1. 极端网络兜底：纯内存二进制分片透传（绝不写磁盘）
      // 帧格式：[1B targetIdLen][targetId UTF8][1B transferIdLen][transferId UTF8][chunk bytes]
      if (isBinary) {
        if (payload.length < 3 || !session.roomKey) return
        const targetLen = payload[0]
        if (payload.length < 2 + targetLen) return
        const targetId = payload.subarray(1, 1 + targetLen).toString('utf8')
        const rest = payload.subarray(1 + targetLen)

        const room = rooms.get(session.roomKey)
        const target = room?.get(targetId)
        if (!target) return

        // 将目标 ID 替换为发送者 ID 转发给接收方
        const senderBuf = Buffer.from(session.info.id, 'utf8')
        const out = Buffer.allocUnsafe(1 + senderBuf.length + rest.length)
        out[0] = senderBuf.length
        senderBuf.copy(out, 1)
        rest.copy(out, 1 + senderBuf.length)
        target.ws.sendBinary(out)
        return
      }

      // 2. JSON 控制与 WebRTC 信令消息
      let msg
      try {
        msg = JSON.parse(payload.toString('utf8'))
      } catch {
        return
      }
      if (!msg || typeof msg !== 'object') return

      if (msg.type === 'hello') {
        const nextDevice = ['phone', 'tablet', 'desktop'].includes(msg.deviceType) ? msg.deviceType : 'desktop'
        const nextOs = typeof msg.osLabel === 'string' ? msg.osLabel.slice(0, 24) : session.info.osLabel
        const nextBrowser = typeof msg.browserLabel === 'string' ? msg.browserLabel.slice(0, 24) : session.info.browserLabel
        session.info.deviceType = nextDevice
        session.info.osLabel = nextOs
        session.info.browserLabel = nextBrowser

        if (typeof msg.customName === 'string') {
          const clean = msg.customName.trim().slice(0, 18)
          if (clean) {
            const room = rooms.get(session.roomKey)
            const conflict = room && Array.from(room.values()).some((s) => s !== session && s.info.name === clean)
            if (!conflict) session.info.name = clean
          }
        }

        session.ws.sendJson({ type: 'self-updated', self: session.info })
        broadcastToRoom(session.roomKey, { type: 'peer-updated', peer: session.info }, session.info.id)
        return
      }

      if (msg.type === 'rename' && typeof msg.name === 'string') {
        const clean = msg.name.trim().slice(0, 18)
        if (!clean) return
        const room = rooms.get(session.roomKey)
        const conflict = room && Array.from(room.values()).some((s) => s !== session && s.info.name === clean)
        session.info.name = conflict ? `${clean}-${crypto.randomInt(10, 99)}` : clean
        session.ws.sendJson({ type: 'self-updated', self: session.info })
        broadcastToRoom(session.roomKey, { type: 'peer-updated', peer: session.info }, session.info.id)
        return
      }

      if (msg.type === 'set-status') {
        session.info.casting = Boolean(msg.casting)
        session.info.castTitle = typeof msg.castTitle === 'string' ? msg.castTitle.trim().slice(0, 36) : ''
        session.ws.sendJson({ type: 'self-updated', self: session.info })
        broadcastToRoom(session.roomKey, { type: 'peer-updated', peer: session.info }, session.info.id)
        return
      }

      if (msg.type === 'join-room') {
        const code = typeof msg.room === 'string' ? msg.room.replace(/\D/g, '').slice(0, 6) : ''
        if (code.length === 6) {
          joinRoom(session, `${session.channel}:pair:${code}`, code)
        } else {
          joinRoom(session, session.autoRoomKey, null)
        }
        return
      }

      // 局域网共享剪贴板频道：纯内存房间实时广播（离开即焚）
      if (session.channel === 'clipboard' && session.roomKey) {
        if (msg.type === 'clip-add' && msg.item && typeof msg.item === 'object') {
          const raw = msg.item
          const kind = ['text', 'link', 'code', 'image'].includes(raw.kind) ? raw.kind : 'text'
          const text = typeof raw.text === 'string' ? raw.text.slice(0, 80_000) : ''
          const imageDataUrl =
            kind === 'image' && typeof raw.imageDataUrl === 'string' && raw.imageDataUrl.startsWith('data:image/')
              ? raw.imageDataUrl.slice(0, MAX_CLIP_IMAGE_LEN)
              : undefined

          if (kind === 'image' && !imageDataUrl) return
          if (kind !== 'image' && !text.trim()) return

          const clip = {
            id: typeof raw.id === 'string' ? raw.id.slice(0, 32) : crypto.randomBytes(6).toString('hex'),
            kind,
            text: kind === 'image' ? (typeof raw.text === 'string' ? raw.text.slice(0, 120) : '') : text,
            imageDataUrl,
            imageWidth: Number(raw.imageWidth) || undefined,
            imageHeight: Number(raw.imageHeight) || undefined,
            pinned: false,
            fromId: session.info.id,
            fromName: session.info.name,
            fromColor: session.info.color,
            deviceType: session.info.deviceType,
            timestamp: Date.now(),
          }

          const list = roomClips.get(session.roomKey) ?? []
          list.unshift(clip)
          if (list.length > MAX_CLIPS_PER_ROOM) {
            list.length = MAX_CLIPS_PER_ROOM
          }
          roomClips.set(session.roomKey, list)
          broadcastToRoom(session.roomKey, { type: 'clip-added', item: clip })
          return
        }

        if (msg.type === 'clip-delete' && typeof msg.id === 'string') {
          const list = roomClips.get(session.roomKey)
          if (!list) return
          const next = list.filter((c) => c.id !== msg.id)
          roomClips.set(session.roomKey, next)
          broadcastToRoom(session.roomKey, { type: 'clip-deleted', id: msg.id })
          return
        }

        if (msg.type === 'clip-pin' && typeof msg.id === 'string') {
          const list = roomClips.get(session.roomKey)
          if (!list) return
          const target = list.find((c) => c.id === msg.id)
          if (!target) return
          target.pinned = Boolean(msg.pinned)
          broadcastToRoom(session.roomKey, { type: 'clip-updated', item: target })
          return
        }

        if (msg.type === 'clip-clear') {
          roomClips.set(session.roomKey, [])
          broadcastToRoom(session.roomKey, { type: 'clip-cleared', byName: session.info.name })
          return
        }
      }

      // 点对点定向转发（WebRTC SDP/ICE 信令、文本秒传、兜底中转控制指令）
      if (typeof msg.to === 'string' && session.roomKey) {
        const room = rooms.get(session.roomKey)
        const target = room?.get(msg.to)
        if (!target) {
          session.ws.sendJson({ type: 'peer-offline', peerId: msg.to })
          return
        }

        if (msg.type === 'signal') {
          target.ws.sendJson({ type: 'signal', from: session.info.id, data: msg.data })
        } else if (msg.type === 'text-message' && typeof msg.text === 'string') {
          target.ws.sendJson({
            type: 'text-message',
            from: session.info.id,
            fromName: session.info.name,
            id: typeof msg.id === 'string' ? msg.id : crypto.randomBytes(4).toString('hex'),
            text: msg.text.slice(0, 50_000),
            timestamp: Date.now(),
          })
        } else if (msg.type === 'relay-control') {
          target.ws.sendJson({
            type: 'relay-control',
            from: session.info.id,
            payload: msg.payload,
          })
        }
      }
    }

    ws.onClose = () => {
      allSessions.delete(session)
      if (session.roomKey) {
        leaveCurrentRoom(session)
      }
    }

    if (head && head.length > 0) {
      ws._onData(head)
    }
  })

  return {
    getStats: () => ({
      onlineDevices: allSessions.size,
      activeRooms: rooms.size,
    }),
    close: () => {
      clearInterval(heartbeatTimer)
      for (const session of allSessions) {
        session.ws.close(1001)
      }
      allSessions.clear()
      rooms.clear()
      roomClips.clear()
    },
  }
}

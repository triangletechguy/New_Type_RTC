import { io } from 'socket.io-client'

function defaultSignalingServerUrl() {
  if (typeof window === 'undefined') return 'http://127.0.0.1:8000'

  const { hostname, port, protocol, origin } = window.location
  const localDevHost = hostname === 'localhost' || hostname === '127.0.0.1'

  if (localDevHost && ['5173', '5174', '4173'].includes(port)) {
    return `${protocol}//${hostname}:8000`
  }

  return origin
}

const SIGNALING_SERVER_URL = import.meta.env.VITE_SIGNALING_SERVER_URL || defaultSignalingServerUrl()

export function createSignalingSocket() {
  return io(SIGNALING_SERVER_URL, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    tryAllTransports: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
    timeout: 15000,
  })
}

export function waitForSocketConnection(socket, timeoutMs = 8000) {
  if (socket.connected) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('Signaling connection timed out.'))
    }, timeoutMs)

    function cleanup() {
      window.clearTimeout(timer)
      socket.off('connect', handleConnect)
      socket.off('connect_error', handleConnectError)
    }

    function handleConnect() {
      cleanup()
      resolve()
    }

    function handleConnectError(error) {
      cleanup()
      reject(new Error(`Signaling error: ${error.message}`))
    }

    socket.once('connect', handleConnect)
    socket.once('connect_error', handleConnectError)
    socket.connect()
  })
}

export function joinSignalingRoom(socket, payload, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    socket.timeout(timeoutMs).emit('join-room', payload, (error, response) => {
      if (error) return reject(new Error('Signaling room join timed out.'))
      if (!response?.ok) return reject(new Error(response?.message || 'Signaling room join failed.'))
      resolve(response)
    })
  })
}

export function emitMediaState(socket, payload, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) return reject(new Error('Signaling socket is not connected.'))

    socket.timeout(timeoutMs).emit('media-state-change', payload, (error, response) => {
      if (error) return reject(new Error('Media state signaling timed out.'))
      if (!response?.ok) return reject(new Error(response?.message || 'Media state signaling failed.'))
      resolve(response)
    })
  })
}

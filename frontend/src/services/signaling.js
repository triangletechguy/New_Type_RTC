import { io } from 'socket.io-client'

const SIGNALING_SERVER_URL = import.meta.env.VITE_SIGNALING_SERVER_URL || 'http://127.0.0.1:8000'

export function createSignalingSocket() {
  return io(SIGNALING_SERVER_URL, {
    autoConnect: false,
    transports: ['websocket'],
    reconnectionAttempts: 5,
    timeout: 8000,
  })
}

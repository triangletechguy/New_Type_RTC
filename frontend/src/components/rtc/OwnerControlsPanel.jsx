import { useEffect, useState } from 'react'
import { apiRequest } from '../../services/api'
import { formatDuration, getInitials } from '../../utils/formatters'
import { roomFeatureOptions, roomPrivacyOptions, themeOptions } from '../../utils/roomConfig'

export function OwnerControlsPanel({ roomId, room, user, joined, signalingRoom, socket, onRoomUpdate }) {
  const [controls, setControls] = useState(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('Controls ready')
  const [savingFields, setSavingFields] = useState({})
  const [moderating, setModerating] = useState({})
  const [privacyPassword, setPrivacyPassword] = useState('')

  const activeRoom = controls?.room || room || {}
  const participants = controls?.participants || []
  const role = controls?.role || (activeRoom.owner_id === user?.id ? 'owner' : 'end_user')
  const canManage = Boolean(controls?.can_manage)

  async function loadControls({ quiet = false } = {}) {
    if (!roomId) return

    try {
      setLoading(true)
      if (!quiet) setStatus('Loading controls...')
      const data = await apiRequest(`/rooms/${roomId}/controls`)
      setControls(data.controls)
      if (data.controls?.room) onRoomUpdate(data.controls.room)
      setStatus(data.controls?.can_manage ? 'Owner controls active' : 'Viewer mode')
    } catch (error) {
      setStatus(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function updateControl(field, value) {
    if (!canManage) return

    try {
      setSavingFields((previous) => ({ ...previous, [field]: true }))
      setStatus('Saving room control...')
      const data = await apiRequest(`/rooms/${roomId}/controls`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value }),
      })
      setControls(data.controls)
      if (data.controls?.room) onRoomUpdate(data.controls.room)
      setStatus('Room control saved')
    } catch (error) {
      setStatus(error.message)
    } finally {
      setSavingFields((previous) => {
        const next = { ...previous }
        delete next[field]
        return next
      })
    }
  }

  async function updatePrivacy(value) {
    if (!canManage) return

    if (value === 'password' && activeRoom.privacy_type !== 'password' && privacyPassword.trim().length < 4) {
      setStatus('Enter a password of at least 4 characters before locking the room.')
      return
    }

    const payload = {
      privacy_type: value,
      ...(value === 'password' && privacyPassword.trim() ? { password: privacyPassword.trim() } : {}),
    }

    try {
      setSavingFields((previous) => ({ ...previous, privacy_type: true }))
      setStatus('Saving privacy...')
      const data = await apiRequest(`/rooms/${roomId}/controls`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      setControls(data.controls)
      if (data.controls?.room) onRoomUpdate(data.controls.room)
      setPrivacyPassword('')
      setStatus(value === 'password' ? 'Room is password protected' : `Room privacy set to ${value}`)
    } catch (error) {
      setStatus(error.message)
    } finally {
      setSavingFields((previous) => {
        const next = { ...previous }
        delete next.privacy_type
        return next
      })
    }
  }

  async function updatePassword() {
    if (!canManage) return
    if (privacyPassword.trim().length < 4) {
      setStatus('Room password must be at least 4 characters.')
      return
    }

    try {
      setSavingFields((previous) => ({ ...previous, password: true }))
      setStatus('Updating password...')
      const data = await apiRequest(`/rooms/${roomId}/controls`, {
        method: 'PATCH',
        body: JSON.stringify({ password: privacyPassword.trim() }),
      })
      setControls(data.controls)
      setPrivacyPassword('')
      setStatus('Room password updated')
    } catch (error) {
      setStatus(error.message)
    } finally {
      setSavingFields((previous) => {
        const next = { ...previous }
        delete next.password
        return next
      })
    }
  }

  async function moderateParticipant(participant, action) {
    if (!canManage || !participant?.user_id) return

    const key = `${participant.user_id}-${action}`
    const endpoint = action === 'mute_mic'
      ? `/rooms/${roomId}/participants/${participant.user_id}/mute`
      : action === 'kick'
        ? `/rooms/${roomId}/participants/${participant.user_id}/kick`
        : action === 'ban'
          ? `/rooms/${roomId}/participants/${participant.user_id}/ban`
          : `/rooms/${roomId}/participants/${participant.user_id}/moderation`
    const body = action === 'ban'
      ? { ban_type: 'permanent', reason: 'Banned from owner controls.' }
      : action === 'disable_camera'
        ? { action }
        : {}

    try {
      setModerating((previous) => ({ ...previous, [key]: true }))
      setStatus('Applying moderation...')
      const data = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      })

      setControls(data.controls)
      setStatus('Moderation action applied')

      if (socket && signalingRoom) {
        socket.timeout(3000).emit(
          'moderation-action',
          {
            roomId: signalingRoom,
            targetUserId: participant.user_id,
            action: data.action || action,
            participant: data.participant,
            ban: data.ban,
          },
          (error, response) => {
            if (error || !response?.ok) setStatus('Moderation saved. Realtime sync will resume when signaling reconnects.')
          }
        )
      }
    } catch (error) {
      setStatus(error.message)
    } finally {
      setModerating((previous) => {
        const next = { ...previous }
        delete next[key]
        return next
      })
    }
  }

  useEffect(() => {
    loadControls({ quiet: true })
  }, [roomId, joined])

  return (
    <section className="glass-card control-panel">
      <div className="control-panel-header">
        <div>
          <span className="eyebrow">Room Ops</span>
          <h3>Owner Controls</h3>
        </div>
        <span className={canManage ? 'role-badge manager' : 'role-badge'}>{role}</span>
      </div>

      <div className="control-summary">
        <div><span>Active</span><strong>{participants.length}</strong></div>
        <div><span>Stage Seats</span><strong>{activeRoom.max_mic_count || 0}</strong></div>
        <div><span>Privacy</span><strong>{activeRoom.privacy_type || 'public'}</strong></div>
      </div>

      <div className="control-section privacy-control">
        <div className="control-section-title">
          <strong>Access</strong>
          <span>{activeRoom.is_password_protected ? 'Password required' : activeRoom.privacy_type || 'public'}</span>
        </div>
        <div className="privacy-control-grid">
          <label>
            <span>Privacy</span>
            <select value={activeRoom.privacy_type || 'public'} onChange={(event) => updatePrivacy(event.target.value)} disabled={!canManage || Boolean(savingFields.privacy_type)}>
              {roomPrivacyOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={privacyPassword}
              onChange={(event) => setPrivacyPassword(event.target.value)}
              placeholder={activeRoom.privacy_type === 'password' ? 'Set new password' : 'Required for password mode'}
              disabled={!canManage || Boolean(savingFields.privacy_type || savingFields.password)}
              autoComplete="new-password"
            />
          </label>
          <button type="button" onClick={updatePassword} disabled={!canManage || activeRoom.privacy_type !== 'password' || privacyPassword.trim().length < 4 || Boolean(savingFields.password)}>
            {savingFields.password ? 'Saving' : 'Update Password'}
          </button>
        </div>
      </div>

      <div className="control-section">
        <div className="control-section-title">
          <strong>Room Settings</strong>
          <button type="button" onClick={() => loadControls()} disabled={loading}>{loading ? 'Loading' : 'Refresh'}</button>
        </div>
        <div className="owner-toggle-grid">
          {roomFeatureOptions.map((option) => (
            <label className="owner-toggle" key={option.field}>
              <input
                type="checkbox"
                checked={Boolean(activeRoom[option.field])}
                onChange={(event) => updateControl(option.field, event.target.checked)}
                disabled={!canManage || Boolean(savingFields[option.field])}
              />
              <span className="toggle-switch"></span>
              <span>
                <strong>{option.label}</strong>
                <small>{savingFields[option.field] ? 'Saving...' : option.detail}</small>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="control-section compact-controls">
        <label>
          <span>Theme</span>
          <select value={activeRoom.theme || 'neon'} onChange={(event) => updateControl('theme', event.target.value)} disabled={!canManage || Boolean(savingFields.theme)}>
            {themeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Stage Seats</span>
          <input
            type="number"
            min="1"
            max="16"
            value={activeRoom.max_mic_count || 1}
            onChange={(event) => updateControl('max_mic_count', event.target.value)}
            disabled={!canManage || Boolean(savingFields.max_mic_count)}
          />
        </label>
      </div>

      <div className="control-section">
        <div className="control-section-title">
          <strong>Participants</strong>
          <span>{canManage ? 'Live actions' : 'Read only'}</span>
        </div>

        <div className="participant-list">
          {participants.length === 0 ? (
            <div className="empty-control">No active participants yet.</div>
          ) : participants.map((participant) => {
            const isSelf = participant.user_id === user?.id
            const muteKey = `${participant.user_id}-mute_mic`
            const cameraKey = `${participant.user_id}-disable_camera`
            const kickKey = `${participant.user_id}-kick`
            const banKey = `${participant.user_id}-ban`
            const actionsDisabled = !canManage || isSelf

            return (
              <article className="participant-row" key={participant.id}>
                <div className="participant-avatar">{getInitials(participant.user_name)}</div>
                <div className="participant-main">
                  <div className="participant-name-row">
                    <strong>{isSelf ? 'You' : participant.user_name}</strong>
                    <span>{participant.role_in_room}</span>
                  </div>
                  <div className="participant-state-row">
                    <span className={participant.mic_enabled ? 'mini-state on' : 'mini-state off'}>{participant.mic_enabled ? 'Mic' : 'Muted'}</span>
                    <span className={participant.camera_enabled ? 'mini-state on' : 'mini-state off'}>{participant.camera_enabled ? 'Cam' : 'Cam off'}</span>
                    <span>{participant.connection_status}</span>
                    <span>{formatDuration(participant.duration_seconds)}</span>
                  </div>
                </div>
                <div className="participant-actions">
                  <button type="button" onClick={() => moderateParticipant(participant, 'mute_mic')} disabled={actionsDisabled || !participant.mic_enabled || Boolean(moderating[muteKey])}>Mute</button>
                  <button type="button" onClick={() => moderateParticipant(participant, 'disable_camera')} disabled={actionsDisabled || !participant.camera_enabled || Boolean(moderating[cameraKey])}>Cam</button>
                  <button type="button" className="danger-mini" onClick={() => moderateParticipant(participant, 'kick')} disabled={actionsDisabled || Boolean(moderating[kickKey])}>Kick</button>
                  <button type="button" className="danger-mini" onClick={() => moderateParticipant(participant, 'ban')} disabled={actionsDisabled || Boolean(moderating[banKey])}>Ban</button>
                </div>
              </article>
            )
          })}
        </div>
      </div>

      <div className="control-status">{status}</div>
    </section>
  )
}

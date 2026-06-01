import { useEffect, useRef, useState } from 'react'
import { avatarForGender } from '../../assets/rtc/catalog'
import { updateProfile } from '../../services/api'

const supportedAvatarTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
const maxAvatarSourceBytes = 6 * 1024 * 1024
const maxAvatarDataUrlLength = 560000

const genderLabels = {
  male: 'Male',
  female: 'Female',
  non_binary: 'Non-binary',
  prefer_not_to_say: 'Prefer not to say',
}

function displayName(user) {
  return user?.name || user?.email?.split('@')[0] || 'Guest'
}

function dateOnly(value) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

function normalizeProfileForm(user) {
  return {
    name: displayName(user),
    gender: user?.gender || '',
    age: user?.age ? String(user.age) : '',
    current_residence: user?.current_residence || '',
    birthday: dateOnly(user?.birthday),
    avatar_url: user?.avatar_url || '',
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Could not read this profile photo.'))
    reader.readAsDataURL(file)
  })
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Choose a different profile photo.'))
    image.src = dataUrl
  })
}

function canvasToDataUrl(canvas) {
  const attempts = [
    ['image/jpeg', 0.88],
    ['image/jpeg', 0.78],
    ['image/jpeg', 0.68],
  ]

  for (const [type, quality] of attempts) {
    const dataUrl = canvas.toDataURL(type, quality)
    if (dataUrl.length <= maxAvatarDataUrlLength) return dataUrl
  }

  return canvas.toDataURL('image/jpeg', 0.6)
}

async function createAvatarDataUrl(file) {
  if (!file) return ''
  if (!supportedAvatarTypes.has(file.type)) {
    throw new Error('Choose a PNG, JPG, or WebP profile photo.')
  }
  if (file.size > maxAvatarSourceBytes) {
    throw new Error('Profile photo must be 6 MB or smaller.')
  }

  const source = await readFileAsDataUrl(file)
  const image = await loadImage(source)
  const side = Math.min(image.naturalWidth || image.width, image.naturalHeight || image.height)
  const size = Math.min(512, side)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  const offsetX = Math.max(0, ((image.naturalWidth || image.width) - side) / 2)
  const offsetY = Math.max(0, ((image.naturalHeight || image.height) - side) / 2)

  context.fillStyle = '#111827'
  context.fillRect(0, 0, size, size)
  context.drawImage(image, offsetX, offsetY, side, side, 0, 0, size, size)

  const dataUrl = canvasToDataUrl(canvas)
  if (dataUrl.length > maxAvatarDataUrlLength) {
    throw new Error('Profile photo is too large after resizing. Choose a smaller photo.')
  }
  return dataUrl
}

export function ProfilePanel({ user, onSaved, onLogout, onClose }) {
  const avatarInputRef = useRef(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(() => normalizeProfileForm(user))
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const name = displayName(user)
  const fallbackAvatar = avatarForGender(form.gender || user?.gender, user?.id || 0)
  const avatar = form.avatar_url === null ? fallbackAvatar : form.avatar_url || user?.avatar_url || fallbackAvatar
  const residence = user?.current_residence || 'Not set'
  const birthday = dateOnly(user?.birthday) || 'Not set'

  useEffect(() => {
    setForm(normalizeProfileForm(user))
    setEditing(false)
    setStatus('')
  }, [user?.id, user?.name, user?.gender, user?.age, user?.current_residence, user?.birthday, user?.avatar_url])

  function change(field, value) {
    setForm((previous) => ({ ...previous, [field]: field === 'age' ? value.replace(/\D/g, '').slice(0, 3) : value }))
    setStatus('')
  }

  function openAvatarPicker() {
    avatarInputRef.current?.click()
  }

  async function changeAvatar(event) {
    const file = event.target.files?.[0]
    if (event.target) event.target.value = ''
    if (!file) return

    setStatus('')
    try {
      const avatarUrl = await createAvatarDataUrl(file)
      setForm((previous) => ({ ...previous, avatar_url: avatarUrl }))
      setStatus('Profile photo ready. Save profile to apply it.')
    } catch (error) {
      setStatus(error.message)
    }
  }

  function removeAvatar() {
    setForm((previous) => ({ ...previous, avatar_url: null }))
    setStatus('Profile photo removed. Save profile to apply it.')
  }

  function cancelEdit() {
    setForm(normalizeProfileForm(user))
    setEditing(false)
    setStatus('')
  }

  async function save(event) {
    event.preventDefault()
    const age = Number(form.age)

    if (form.name.trim().length < 2) {
      setStatus('Name must be at least 2 characters.')
      return
    }

    if (!form.gender) {
      setStatus('Gender is required.')
      return
    }

    if (!Number.isInteger(age) || age < 13 || age > 120) {
      setStatus('Age must be between 13 and 120.')
      return
    }

    if (form.current_residence.trim().length < 2) {
      setStatus('Current residence country is required.')
      return
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.birthday)) {
      setStatus('Birthday is required.')
      return
    }

    setSaving(true)
    try {
      const data = await updateProfile({
        name: form.name.trim(),
        gender: form.gender,
        age,
        current_residence: form.current_residence.trim(),
        birthday: form.birthday,
        avatar_url: form.avatar_url || null,
      })
      onSaved?.(data.user)
      setEditing(false)
      setStatus(data.message || 'Profile updated.')
    } catch (error) {
      setStatus(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="buzzcast-profile-panel profile-panel-card">
      <div className="buzzcast-profile-hero">
        {editing ? (
          <div className="profile-photo-editor">
            <button type="button" className="buzzcast-profile-avatar profile-photo-button image-avatar" onClick={openAvatarPicker} disabled={saving} aria-label="Change profile photo">
              <img src={avatar} alt="" loading="lazy" />
              <span>Change</span>
            </button>
            <input
              ref={avatarInputRef}
              className="profile-photo-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={changeAvatar}
              disabled={saving}
            />
            {form.avatar_url ? <button type="button" className="profile-photo-remove" onClick={removeAvatar} disabled={saving}>Remove</button> : null}
          </div>
        ) : (
          <div className="buzzcast-profile-avatar image-avatar">
            <img src={avatar} alt="" loading="lazy" />
          </div>
        )}
        <div>
          <h1>{name}</h1>
          <span>ID:{user?.id || 0}</span>
          <div className="buzzcast-profile-badges">
            <strong>{user?.age || '--'}</strong>
            <strong>{genderLabels[user?.gender] || 'Profile'}</strong>
          </div>
          <p>Email <b>{user?.email || 'Not set'}</b></p>
          <small>{residence}</small>
        </div>
        {onClose ? <button type="button" className="profile-close-button" onClick={onClose} aria-label="Close profile">x</button> : null}
      </div>

      {editing ? (
        <form className="profile-edit-form" onSubmit={save}>
          <label>Name</label>
          <input value={form.name} onChange={(event) => change('name', event.target.value)} autoComplete="name" />
          <div className="profile-edit-row">
            <label>
              <span>Gender</span>
              <select value={form.gender} onChange={(event) => change('gender', event.target.value)}>
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="non_binary">Non-binary</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </label>
            <label>
              <span>Age</span>
              <input value={form.age} onChange={(event) => change('age', event.target.value)} inputMode="numeric" />
            </label>
          </div>
          <div className="profile-edit-row residence-fields">
            <label>
              <span>Current Residence</span>
              <input
                value={form.current_residence}
                onChange={(event) => change('current_residence', event.target.value)}
                autoComplete="country-name"
                placeholder="Country"
              />
            </label>
            <label>
              <span>Birthday</span>
              <input
                type="date"
                value={form.birthday}
                onChange={(event) => change('birthday', event.target.value)}
              />
            </label>
          </div>
          <footer>
            <button type="button" className="secondary-button" onClick={cancelEdit} disabled={saving}>Cancel</button>
            <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving...' : 'Save profile'}</button>
          </footer>
        </form>
      ) : (
        <>
          <div className="buzzcast-profile-grid">
            <h2>Profile</h2>
            <dl>
              <dt>Name</dt><dd>{name}</dd>
              <dt>Gender</dt><dd>{genderLabels[user?.gender] || 'Not set'}</dd>
              <dt>Age</dt><dd>{user?.age || 'Not set'}</dd>
              <dt>Birthday</dt><dd>{birthday}</dd>
              <dt>Email</dt><dd>{user?.email || 'Not set'}</dd>
              <dt>Current Residence</dt><dd>{residence}</dd>
            </dl>
          </div>
          <div className="buzzcast-profile-links">
            <button type="button" onClick={() => setEditing(true)}>Edit profile</button>
            {onLogout ? <button type="button" onClick={onLogout}>Sign out</button> : null}
          </div>
        </>
      )}

      {status ? <div className="profile-status">{status}</div> : null}
    </section>
  )
}

export function ProfileModal({ open, user, onSaved, onLogout, onClose }) {
  if (!open || !user) return null

  return (
    <div className="profile-modal-backdrop" onMouseDown={onClose}>
      <div className="profile-modal" onMouseDown={(event) => event.stopPropagation()}>
        <ProfilePanel user={user} onSaved={onSaved} onLogout={onLogout} onClose={onClose} />
      </div>
    </div>
  )
}

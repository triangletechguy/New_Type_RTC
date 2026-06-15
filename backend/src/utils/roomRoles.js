const ROOM_ROLE_RANK = Object.freeze({
  end_user: 0,
  audience: 0,
  speaker: 0,
  moderator: 1,
  admin: 2,
  owner: 3,
})

const ROOM_MANAGER_ROLES = new Set(['owner', 'admin', 'moderator'])
const ROOM_PUBLISHER_ROLES = new Set(['owner', 'admin', 'moderator', 'speaker'])
const ROOM_SETTINGS_ROLES = new Set(['owner', 'admin'])
const ASSIGNABLE_ROOM_ROLES = new Set(['admin', 'moderator'])
const STAGE_DECISION_ROLES = new Set(['owner'])
const MOVABLE_STAGE_ROLES = new Set(['end_user', 'audience', 'speaker'])

function normalizeRoomRole(role, fallback = 'end_user') {
  const normalized = String(role || '').trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(ROOM_ROLE_RANK, normalized) ? normalized : fallback
}

function roomRoleRank(role) {
  return ROOM_ROLE_RANK[normalizeRoomRole(role)] || 0
}

function canManageRoom(role) {
  return ROOM_MANAGER_ROLES.has(normalizeRoomRole(role))
}

function canPublishRoomMedia(role) {
  return ROOM_PUBLISHER_ROLES.has(normalizeRoomRole(role))
}

function canUpdateRoomSettings(role) {
  return ROOM_SETTINGS_ROLES.has(normalizeRoomRole(role))
}

function canAssignRoomRoles(role) {
  return normalizeRoomRole(role) === 'owner'
}

function canApproveStageRequests(role) {
  return STAGE_DECISION_ROLES.has(normalizeRoomRole(role))
}

function canModerateTarget(actorRole, targetRole) {
  return canManageRoom(actorRole) && roomRoleRank(actorRole) > roomRoleRank(targetRole)
}

function roleCanBeMovedByStagePermission(role) {
  return MOVABLE_STAGE_ROLES.has(normalizeRoomRole(role))
}

function roomRoleCapabilities(role) {
  const normalizedRole = normalizeRoomRole(role)

  return {
    role: normalizedRole,
    rank: roomRoleRank(normalizedRole),
    can_manage: canManageRoom(normalizedRole),
    can_publish_media: canPublishRoomMedia(normalizedRole),
    can_update_settings: canUpdateRoomSettings(normalizedRole),
    can_assign_roles: canAssignRoomRoles(normalizedRole),
    can_approve_stage: canApproveStageRequests(normalizedRole),
    can_moderate: canManageRoom(normalizedRole),
    can_request_stage: !canPublishRoomMedia(normalizedRole),
  }
}

module.exports = {
  ASSIGNABLE_ROOM_ROLES,
  ROOM_MANAGER_ROLES,
  ROOM_PUBLISHER_ROLES,
  ROOM_ROLE_RANK,
  canApproveStageRequests,
  canAssignRoomRoles,
  canManageRoom,
  canModerateTarget,
  canPublishRoomMedia,
  canUpdateRoomSettings,
  normalizeRoomRole,
  roleCanBeMovedByStagePermission,
  roomRoleCapabilities,
  roomRoleRank,
}

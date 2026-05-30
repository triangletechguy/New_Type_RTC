export const ADMIN_DASHBOARD_ROLES = ['client_admin', 'super_admin']

function roleName(role) {
  return String(typeof role === 'string' ? role : role?.name || '')
    .trim()
    .toLowerCase()
}

export function hasAnyRole(user, allowedRoles) {
  const roles = Array.isArray(user?.roles) ? user.roles : []
  const allowed = new Set((allowedRoles || []).map(roleName).filter(Boolean))

  return roles.some((role) => allowed.has(roleName(role)))
}

export function canUseAdminDashboard(user) {
  return hasAnyRole(user, ADMIN_DASHBOARD_ROLES)
}

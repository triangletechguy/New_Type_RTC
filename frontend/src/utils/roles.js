export function hasAnyRole(user, allowedRoles) {
  const roles = Array.isArray(user?.roles) ? user.roles : []
  const allowed = new Set(allowedRoles)

  return roles.some((role) => allowed.has(typeof role === 'string' ? role : role?.name))
}

export function canUseAdminDashboard(user) {
  return hasAnyRole(user, ['client_admin', 'super_admin'])
}

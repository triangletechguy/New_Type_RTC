const express = require('express')
const { query, transaction } = require('../config/db')
const { authMiddleware, hasAnyRole, requireAnyRole } = require('../middleware/auth')
const {
  ADMIN_ROLES,
  cleanString,
  createAdminRoom,
  createClientAppForTenant,
  createClientCompany,
  deleteClientAppForTenant,
  createPlanRequest,
  ensureTenantCompanyColumns,
  getAdminStats,
  getAdminUser,
  getClientAdmins,
  getClientApps,
  getClientRows,
  getDashboard,
  getPlanRequests,
  getRoomRows,
  getScopedRoomIds,
  getServicePlans,
  getTenantRoomIds,
  getTenantUsers,
  getUniqueTenantUid,
  buildScopePayload,
  inviteClientCompanyAdmin,
  normalizeAdmin,
  normalizeAdminRoomStatus,
  normalizeCompanyStatus,
  parseAdminRoomPayload,
  parseCompanyPayload,
  parseServicePlanPayload,
  reviewPlanRequest,
  roleList,
  rotateClientAppCredentials,
  setAdminRoomStatus,
  updateClientAppForTenant,
  updateClientCompany,
} = require('../services/adminService')

const router = express.Router()

router.use(authMiddleware, requireAnyRole(ADMIN_ROLES))

router.get('/companies/generate-tenant-id', async (req, res, next) => {
  try {
    if (!hasAnyRole(req.user, ['super_admin'])) {
      return res.status(403).json({ message: 'Only the platform service admin can generate tenant IDs.' })
    }

    await ensureTenantCompanyColumns()
    const companyName = cleanString(req.query?.company_name || req.query?.companyName || '', 150)
    const tenantId = await transaction(async (connection) => getUniqueTenantUid(connection, companyName))

    return res.json({
      tenant_id: tenantId,
      tenant_uid: tenantId,
      format: 'tenant_companyname_random',
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/companies', async (req, res, next) => {
  try {
    if (!hasAnyRole(req.user, ['super_admin'])) {
      return res.status(403).json({ message: 'Only the platform service admin can view all client companies.' })
    }

    return res.json({ companies: await getClientRows() })
  } catch (error) {
    return next(error)
  }
})

router.post('/companies', async (req, res, next) => {
  try {
    if (!hasAnyRole(req.user, ['super_admin'])) {
      return res.status(403).json({ message: 'Only the platform service admin can create client companies.' })
    }

    const { errors, payload } = parseCompanyPayload(req.body || {})
    if (Object.keys(errors).length) {
      return res.status(422).json({ message: 'Check the company setup form.', errors })
    }

    const created = await createClientCompany(payload)
    const [company] = await getClientRows(created.tenantId)

    return res.status(201).json({
      message: `${company.name} company created successfully.`,
      company,
      admin_account: created.admin_account,
      admin_invite: created.admin_invite,
      next_step: 'Generate app access for this company.',
    })
  } catch (error) {
    return next(error)
  }
})

router.patch('/companies/:companyId', async (req, res, next) => {
  try {
    if (!hasAnyRole(req.user, ['super_admin'])) {
      return res.status(403).json({ message: 'Only the platform service admin can edit client companies.' })
    }

    const companyId = Number(req.params.companyId)
    if (!Number.isInteger(companyId) || companyId <= 0) {
      return res.status(400).json({ message: 'Invalid company id.' })
    }

    const { errors, payload } = parseCompanyPayload(req.body || {})
    delete errors.tenant_id

    if (Object.keys(errors).length) {
      return res.status(422).json({ message: 'Check the company edit form.', errors })
    }

    await updateClientCompany(companyId, payload)
    const [company] = await getClientRows(companyId)

    return res.json({
      message: `${company.name} company updated successfully.`,
      company,
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/companies/:companyId/admin-invite', async (req, res, next) => {
  try {
    if (!hasAnyRole(req.user, ['super_admin'])) {
      return res.status(403).json({ message: 'Only the platform service admin can invite company service admins.' })
    }

    const companyId = Number(req.params.companyId)
    if (!Number.isInteger(companyId) || companyId <= 0) {
      return res.status(400).json({ message: 'Invalid company id.' })
    }

    const { adminAccount, adminInvite } = await inviteClientCompanyAdmin(companyId, req.body || {})
    const [company] = await getClientRows(companyId)

    return res.status(201).json({
      message: `Company service admin invite created for ${adminInvite.invited_email}.`,
      company,
      admin_account: adminAccount,
      admin_invite: adminInvite,
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/companies/:companyId', async (req, res, next) => {
  try {
    if (!hasAnyRole(req.user, ['super_admin'])) {
      return res.status(403).json({ message: 'Only the platform service admin can inspect client companies.' })
    }

    const companyId = Number(req.params.companyId)
    if (!Number.isInteger(companyId) || companyId <= 0) {
      return res.status(400).json({ message: 'Invalid company id.' })
    }

    const [company] = await getClientRows(companyId)
    if (!company) return res.status(404).json({ message: 'Company was not found.' })

    return res.json({ company })
  } catch (error) {
    return next(error)
  }
})

router.get('/companies/:companyId/detail', async (req, res, next) => {
  try {
    if (!hasAnyRole(req.user, ['super_admin'])) {
      return res.status(403).json({ message: 'Only the platform service admin can inspect client companies.' })
    }

    const companyId = Number(req.params.companyId)
    if (!Number.isInteger(companyId) || companyId <= 0) {
      return res.status(400).json({ message: 'Invalid company id.' })
    }

    const [company] = await getClientRows(companyId)
    if (!company) return res.status(404).json({ message: 'Company was not found.' })

    const roomIds = await getTenantRoomIds(companyId)
    const [payload, users] = await Promise.all([
      buildScopePayload({
        roomIds,
        enterpriseScope: 'client_admin',
        tenantId: companyId,
      }),
      getTenantUsers(companyId),
    ])

    return res.json({
      scope: 'company_detail',
      company,
      users,
      ...payload,
    })
  } catch (error) {
    return next(error)
  }
})

router.patch('/companies/:companyId/status', async (req, res, next) => {
  try {
    if (!hasAnyRole(req.user, ['super_admin'])) {
      return res.status(403).json({ message: 'Only the platform service admin can change company status.' })
    }

    const companyId = Number(req.params.companyId)
    const status = normalizeCompanyStatus(req.body?.status)

    if (!Number.isInteger(companyId) || companyId <= 0) {
      return res.status(400).json({ message: 'Invalid company id.' })
    }

    await ensureTenantCompanyColumns()
    const result = await query(
      `
      UPDATE tenants
      SET status = :status,
          updated_at = NOW()
      WHERE id = :companyId
      `,
      { status, companyId }
    )

    if (!result.affectedRows) return res.status(404).json({ message: 'Company was not found.' })
    const [company] = await getClientRows(companyId)

    return res.json({ message: 'Company status updated.', company })
  } catch (error) {
    return next(error)
  }
})

router.get('/plan-requests', async (req, res, next) => {
  try {
    const tenantId = hasAnyRole(req.user, ['super_admin']) ? null : req.user.tenant_id
    return res.json({ plan_requests: await getPlanRequests(tenantId) })
  } catch (error) {
    return next(error)
  }
})

router.patch('/service-plans/:planId', async (req, res, next) => {
  try {
    if (!hasAnyRole(req.user, ['super_admin'])) {
      return res.status(403).json({ message: 'Only the platform service admin can edit service packages.' })
    }

    await ensureTenantCompanyColumns()

    const planId = Number(req.params.planId)
    if (!Number.isInteger(planId) || planId <= 0) {
      return res.status(400).json({ message: 'Invalid service package id.' })
    }

    const { errors, payload } = parseServicePlanPayload(req.body || {})
    if (Object.keys(errors).length) {
      return res.status(422).json({ message: 'Check service package fields.', errors })
    }

    const result = await query(
      `
      UPDATE service_plans
      SET name = :name,
          description = :description,
          monthly_base_price = :monthlyBasePrice,
          minute_rate = :minuteRate,
          monthly_minute_allowance = :monthlyMinuteAllowance,
          max_room_admins = :maxRoomAdmins,
          max_rooms = :maxRooms,
          max_apps = :maxApps,
          max_participants_per_room = :maxParticipantsPerRoom,
          included_features = :includedFeatures,
          status = :status,
          updated_at = NOW()
      WHERE id = :planId
      `,
      {
        planId,
        name: payload.name,
        description: payload.description,
        monthlyBasePrice: payload.monthlyBasePrice,
        minuteRate: payload.minuteRate,
        monthlyMinuteAllowance: payload.monthlyMinuteAllowance,
        maxRoomAdmins: payload.maxRoomAdmins,
        maxRooms: payload.maxRooms,
        maxApps: payload.maxApps,
        maxParticipantsPerRoom: payload.maxParticipantsPerRoom,
        includedFeatures: JSON.stringify(payload.includedFeatures),
        status: payload.status,
      }
    )

    if (!result.affectedRows) return res.status(404).json({ message: 'Service package was not found.' })

    const plans = await getServicePlans()
    const plan = plans.find((item) => Number(item.id) === Number(planId))

    return res.json({
      message: `${plan?.name || 'Service package'} updated.`,
      plan,
      plans,
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/plan-requests', async (req, res, next) => {
  try {
    if (hasAnyRole(req.user, ['super_admin'])) {
      return res.status(403).json({ message: 'The platform service admin assigns packages from the client company editor.' })
    }

    const requestId = await createPlanRequest(req.user, req.body || {})
    const requests = await getPlanRequests(req.user.tenant_id)
    const request = requests.find((item) => Number(item.id) === Number(requestId)) || requests[0]

    return res.status(201).json({
      message: `${request?.requested_plan?.name || 'Package'} purchase request sent for review.`,
      plan_request: request,
    })
  } catch (error) {
    return next(error)
  }
})

router.patch('/plan-requests/:requestId', async (req, res, next) => {
  try {
    if (!hasAnyRole(req.user, ['super_admin'])) {
      return res.status(403).json({ message: 'Only the platform service admin can review package purchase requests.' })
    }

    const requestId = Number(req.params.requestId)
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ message: 'Invalid package request id.' })
    }

    await reviewPlanRequest(requestId, req.user, req.body || {})
    const requests = await getPlanRequests()
    const request = requests.find((item) => Number(item.id) === Number(requestId))

    return res.json({
      message: `Package request ${request?.status || 'reviewed'}.`,
      plan_request: request,
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/client-apps', async (req, res, next) => {
  try {
    const app = await createClientAppForTenant(req.user, req.body || {})
    const { credentials, ...publicApp } = app

    return res.status(201).json({
      message: `${app.name} app access generated.`,
      app: publicApp,
      credentials,
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/client-apps/:appId/rotate-credentials', async (req, res, next) => {
  try {
    const appId = Number(req.params.appId)
    if (!Number.isInteger(appId) || appId <= 0) {
      return res.status(400).json({ message: 'Invalid client app id.' })
    }

    const result = await rotateClientAppCredentials(req.user, appId, req.body || {})
    const apps = await getClientApps(result.tenant_id)
    const app = apps.find((item) => Number(item.id) === Number(appId)) || result.app

    return res.json({
      message: `${app?.name || 'Client app'} credentials rotated. Update the client backend before using old keys again.`,
      app,
      credentials: result.credentials,
    })
  } catch (error) {
    return next(error)
  }
})

router.patch('/client-apps/:appId', async (req, res, next) => {
  try {
    const appId = Number(req.params.appId)
    if (!Number.isInteger(appId) || appId <= 0) {
      return res.status(400).json({ message: 'Invalid client app id.' })
    }

    const tenantId = await updateClientAppForTenant(req.user, appId, req.body || {})
    const apps = await getClientApps(tenantId)
    const app = apps.find((item) => Number(item.id) === Number(appId))

    return res.json({
      message: `${app?.name || 'Client app'} updated.`,
      app,
    })
  } catch (error) {
    return next(error)
  }
})

router.delete('/client-apps/:appId', async (req, res, next) => {
  try {
    const appId = Number(req.params.appId)
    if (!Number.isInteger(appId) || appId <= 0) {
      return res.status(400).json({ message: 'Invalid client app id.' })
    }

    const result = await deleteClientAppForTenant(req.user, appId)
    const apps = await getClientApps(result.tenant_id)

    return res.json({
      message: `${result.app?.name || 'Client app'} deleted. Old app key, API key, and access token are no longer accepted.`,
      app_id: appId,
      app: result.app,
      apps,
    })
  } catch (error) {
    return next(error)
  }
})

router.post('/rooms', async (req, res, next) => {
  try {
    const { errors, payload } = parseAdminRoomPayload(req.body || {})
    if (Object.keys(errors).length) {
      return res.status(422).json({ message: 'Check the room setup form.', errors })
    }

    const roomId = await createAdminRoom(req.user, payload)
    const [room] = await getRoomRows([roomId])

    return res.status(201).json({
      message: `${room?.name || 'Room'} created successfully.`,
      room,
    })
  } catch (error) {
    return next(error)
  }
})

router.patch('/rooms/:roomId/status', async (req, res, next) => {
  try {
    const roomId = Number(req.params.roomId)
    const status = normalizeAdminRoomStatus(req.body?.status)

    if (!Number.isInteger(roomId) || roomId <= 0) {
      return res.status(400).json({ message: 'Invalid room id.' })
    }

    await setAdminRoomStatus(req.user, roomId, status)
    const [room] = await getRoomRows([roomId])

    return res.json({
      message: status === 'active' ? 'Room is active and available.' : 'Room availability updated.',
      room,
    })
  } catch (error) {
    return next(error)
  }
})

router.delete('/rooms/:roomId', async (req, res, next) => {
  try {
    const roomId = Number(req.params.roomId)

    if (!Number.isInteger(roomId) || roomId <= 0) {
      return res.status(400).json({ message: 'Invalid room id.' })
    }

    await setAdminRoomStatus(req.user, roomId, 'ended')

    return res.json({
      message: 'Room removed from availability. Usage history is preserved.',
      room_id: roomId,
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/dashboard', async (req, res, next) => {
  try {
    const roomIds = hasAnyRole(req.user, ['super_admin'])
      ? null
      : await getTenantRoomIds(req.user.tenant_id)

    return res.json({ dashboard: await getDashboard(roomIds) })
  } catch (error) {
    return next(error)
  }
})

router.get('/overview', async (req, res, next) => {
  try {
    const isSuperAdmin = hasAnyRole(req.user, ['super_admin'])

    if (isSuperAdmin) {
      const adminRows = await getClientAdmins()
      const admins = await Promise.all(adminRows.map(async (admin) => {
        const roomIds = await getScopedRoomIds(admin.id, admin.tenant_id)
        return normalizeAdmin(admin, await getAdminStats(roomIds))
      }))
      const platform = await buildScopePayload({ roomIds: null, enterpriseScope: 'super_admin' })

      return res.json({
        scope: 'super_admin',
        roles: roleList(req.user),
        admins,
        ...platform,
      })
    }

    const adminRow = await getAdminUser(req.user.id)
    const roomIds = await getTenantRoomIds(req.user.tenant_id)
    const payload = await buildScopePayload({
      adminRow,
      roomIds,
      enterpriseScope: 'client_admin',
      tenantId: req.user.tenant_id,
    })

    return res.json({
      scope: 'client_admin',
      roles: roleList(req.user),
      ...payload,
    })
  } catch (error) {
    return next(error)
  }
})

router.get('/admins/:adminId', async (req, res, next) => {
  try {
    if (!hasAnyRole(req.user, ['super_admin'])) {
      return res.status(403).json({ message: 'Only the platform service admin can inspect another company service admin.' })
    }

    const adminId = Number(req.params.adminId)
    if (!Number.isInteger(adminId) || adminId <= 0) {
      return res.status(400).json({ message: 'Invalid company service admin id.' })
    }

    const adminRow = await getAdminUser(adminId)
    const adminRoles = String(adminRow?.roles || '').split(',')
    if (!adminRow || !adminRoles.includes('client_admin') || adminRoles.includes('super_admin')) {
      return res.status(404).json({ message: 'Company service admin was not found.' })
    }

    const roomIds = await getScopedRoomIds(adminId, adminRow.tenant_id)
    const payload = await buildScopePayload({
      adminRow,
      roomIds,
      enterpriseScope: 'client_admin',
      tenantId: adminRow.tenant_id,
    })

    return res.json({
      scope: 'admin_detail',
      ...payload,
    })
  } catch (error) {
    return next(error)
  }
})

module.exports = router

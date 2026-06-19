package io.agora.agora_manager

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.SurfaceView
import android.view.View
import androidx.core.content.ContextCompat
import io.agora.rtc2.ChannelMediaOptions
import io.agora.rtc2.Constants
import io.agora.rtc2.IRtcEngineEventHandler
import io.agora.rtc2.IRtcEngineEventHandler.ErrorCode
import io.agora.rtc2.RtcEngine
import io.agora.rtc2.RtcEngineConfig
import io.agora.rtc2.video.VideoCanvas
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder

private data class AgoraJoinResult(
    val joined: Boolean,
    val error: RtcEnterpriseException? = null,
)

class RtcEnterpriseAndroidSdk(
    context: Context,
    apiBaseUrl: String,
    clientApiKey: String,
    private val agoraAppId: String,
    private val httpClient: OkHttpClient = OkHttpClient(),
) {
    private val appContext = context.applicationContext
    private val viewContext = context
    private val mainHandler = Handler(Looper.getMainLooper())
    private val baseUrl = apiBaseUrl.trim().trimEnd('/')
    private val apiKey = clientApiKey.trim()

    private var agoraEngine: RtcEngine? = null
    private var listener: Listener? = null
    private var activeJoinRequest: RtcEnterpriseJoinRequest? = null
    private var activeJoinHandle: RtcEnterpriseJoinHandle? = null
    private var microphoneEnabled = true
    private var cameraEnabled = true

    interface Listener {
        fun onEvent(event: RtcEnterpriseEvent) {}
        fun onRemoteUserJoined(remoteUid: Int, surfaceView: SurfaceView) {}
        fun onRemoteUserLeft(remoteUid: Int) {}
        fun onError(error: RtcEnterpriseException) {}
    }

    interface ResultCallback<T> {
        fun onSuccess(result: T)
        fun onError(error: RtcEnterpriseException)
    }

    fun setListener(listener: Listener?) {
        this.listener = listener
    }

    fun hasRequiredPermissions(): Boolean {
        return REQUIRED_PERMISSIONS.all { permission ->
            ContextCompat.checkSelfPermission(appContext, permission) == PackageManager.PERMISSION_GRANTED
        }
    }

    fun me(callback: ResultCallback<RtcClientMeEnvelope>) {
        requestJson("GET", "/client/me", null, emptyMap(), callback) {
            RtcClientMeEnvelope(it)
        }
    }

    fun syncExternalUser(
        request: RtcExternalUserSyncRequest,
        callback: ResultCallback<RtcExternalUserEnvelope>,
    ) {
        if (!validateRequest(request.validationErrors(), callback)) return
        requestJson("POST", "/client/users/sync", request.toJson(), emptyMap(), callback) {
            RtcExternalUserEnvelope(it)
        }
    }

    fun getExternalUser(externalUserId: String, callback: ResultCallback<RtcExternalUserEnvelope>) {
        if (!validateRequest(validateExternalUserId(externalUserId), callback)) return
        requestJson(
            "GET",
            "/client/users/${urlEncode(externalUserId)}",
            null,
            emptyMap(),
            callback,
        ) {
            RtcExternalUserEnvelope(it)
        }
    }

    fun listRooms(
        query: RtcRoomListQuery = RtcRoomListQuery(),
        callback: ResultCallback<RtcRoomListEnvelope>,
    ) {
        if (!validateRequest(query.validationErrors(), callback)) return
        requestJson("GET", "/client/rooms", null, query.toQuery(), callback) {
            RtcRoomListEnvelope(it)
        }
    }

    fun createRoom(
        request: RtcRoomCreateRequest,
        callback: ResultCallback<RtcRoomEnvelope>,
    ) {
        if (!validateRequest(request.validationErrors(), callback)) return
        requestJson("POST", "/client/rooms", request.toJson(), emptyMap(), callback) {
            RtcRoomEnvelope(it)
        }
    }

    fun getRoom(roomId: Int, callback: ResultCallback<RtcRoomEnvelope>) {
        if (!validateRequest(validateRoomId(roomId), callback)) return
        requestJson("GET", "/client/rooms/$roomId", null, emptyMap(), callback) {
            RtcRoomEnvelope(it)
        }
    }

    fun updateRoom(
        roomId: Int,
        updates: JSONObject,
        callback: ResultCallback<RtcRoomEnvelope>,
    ) {
        if (!validateRequest(validateRoomId(roomId), callback)) return
        requestJson("PATCH", "/client/rooms/$roomId", updates, emptyMap(), callback) {
            RtcRoomEnvelope(it)
        }
    }

    fun updateRoomStatus(
        roomId: Int,
        status: String,
        callback: ResultCallback<RtcRoomEnvelope>,
    ) {
        val errors = validateRoomId(roomId).toMutableMap()
        if (!VALID_ROOM_STATUSES.contains(status.trim().lowercase())) {
            errors["status"] = "Choose active, inactive, or ended."
        }
        if (!validateRequest(errors, callback)) return
        requestJson(
            "PATCH",
            "/client/rooms/$roomId/status",
            JSONObject().put("status", status),
            emptyMap(),
            callback,
        ) {
            RtcRoomEnvelope(it)
        }
    }

    fun disableRoom(roomId: Int, callback: ResultCallback<RtcRoomEnvelope>) {
        if (!validateRequest(validateRoomId(roomId), callback)) return
        requestJson("POST", "/client/rooms/$roomId/disable", null, emptyMap(), callback) {
            RtcRoomEnvelope(it)
        }
    }

    fun endRoom(roomId: Int, callback: ResultCallback<RtcRoomEndEnvelope>) {
        if (!validateRequest(validateRoomId(roomId), callback)) return
        requestJson("DELETE", "/client/rooms/$roomId", null, emptyMap(), callback) {
            RtcRoomEndEnvelope(it)
        }
    }

    fun issueRtcToken(
        request: RtcTokenRequest,
        callback: ResultCallback<RtcTokenIssue>,
    ) {
        if (!validateRequest(request.validationErrors(), callback)) return
        requestJson("POST", "/client/rtc/token", request.toJson(), emptyMap(), callback) {
            RtcTokenIssue(it)
        }
    }

    fun startSession(
        request: RtcSessionRequest,
        callback: ResultCallback<RtcSessionEnvelope>,
    ) {
        if (!validateRequest(request.validationErrors(), callback)) return
        requestJson("POST", "/client/rtc/session/start", request.toJson(), emptyMap(), callback) {
            RtcSessionEnvelope(it)
        }
    }

    fun endSession(
        request: RtcSessionRequest,
        callback: ResultCallback<RtcSessionEndEnvelope>,
    ) {
        if (!validateRequest(request.validationErrors(), callback)) return
        requestJson("POST", "/client/rtc/session/end", request.toJson(), emptyMap(), callback) {
            RtcSessionEndEnvelope(it)
        }
    }

    fun joinRoom(
        request: RtcEnterpriseJoinRequest,
        callback: ResultCallback<RtcEnterpriseJoinHandle>,
    ) {
        if (!validateRequest(request.validationErrors(), callback)) return
        activeJoinRequest = request
        microphoneEnabled = request.microphoneEnabled
        cameraEnabled = request.cameraEnabled

        if (request.syncExternalUserBeforeJoin) {
            syncExternalUser(request.externalUser, object : ResultCallback<RtcExternalUserEnvelope> {
                override fun onSuccess(result: RtcExternalUserEnvelope) {
                    issueTokenThenStartSessionThenJoinMedia(request, callback)
                }

                override fun onError(error: RtcEnterpriseException) {
                    activeJoinRequest = null
                    callback.onError(error)
                }
            })
            return
        }

        issueTokenThenStartSessionThenJoinMedia(request, callback)
    }

    fun leaveRoom(callback: ResultCallback<RtcSessionEndEnvelope>? = null) {
        val handle = activeJoinHandle
        if (agoraEngine != null) {
            agoraEngine?.leaveChannel()
            emit(RtcEnterpriseEvent.LeftMedia)
        }

        if (handle == null) {
            activeJoinRequest = null
            deliverErrorIfPresent(
                callback,
                RtcEnterpriseException(
                    statusCode = 409,
                    code = "no_active_session",
                    message = "No active RTC session is tracked by this SDK instance.",
                ),
            )
            return
        }

        endSession(
            RtcSessionRequest(
                externalUserId = handle.externalUserId,
                roomId = handle.roomId,
                sessionId = handle.session.sessionId,
                role = handle.role,
                rtcMode = handle.mediaType,
                microphoneEnabled = microphoneEnabled,
                cameraEnabled = cameraEnabled,
            ),
            object : ResultCallback<RtcSessionEndEnvelope> {
                override fun onSuccess(result: RtcSessionEndEnvelope) {
                    activeJoinRequest = null
                    activeJoinHandle = null
                    emit(RtcEnterpriseEvent.UsageSessionEnded(result.sessionId, result.durationSeconds))
                    callback?.onSuccess(result)
                }

                override fun onError(error: RtcEnterpriseException) {
                    callback?.onError(error)
                    listener?.onError(error)
                }
            },
        )
    }

    val localVideo: SurfaceView
        get() {
            ensureAgoraEngine()
            val localSurfaceView = SurfaceView(viewContext)
            localSurfaceView.visibility = View.VISIBLE
            agoraEngine?.setupLocalVideo(
                VideoCanvas(localSurfaceView, VideoCanvas.RENDER_MODE_HIDDEN, 0),
            )
            return localSurfaceView
        }

    fun setMicrophoneEnabled(enabled: Boolean) {
        microphoneEnabled = enabled
        agoraEngine?.muteLocalAudioStream(!enabled)
        emit(RtcEnterpriseEvent.LocalMediaChanged(microphoneEnabled, cameraEnabled))
    }

    fun setCameraEnabled(enabled: Boolean) {
        cameraEnabled = enabled
        agoraEngine?.enableLocalVideo(enabled)
        agoraEngine?.muteLocalVideoStream(!enabled)
        emit(RtcEnterpriseEvent.LocalMediaChanged(microphoneEnabled, cameraEnabled))
    }

    fun switchCamera() {
        agoraEngine?.switchCamera()
        emit(RtcEnterpriseEvent.CameraSwitched)
    }

    fun release() {
        activeJoinRequest = null
        activeJoinHandle = null
        agoraEngine?.leaveChannel()
        agoraEngine = null
        RtcEngine.destroy()
        emit(RtcEnterpriseEvent.Released)
    }

    private fun issueTokenThenStartSessionThenJoinMedia(
        request: RtcEnterpriseJoinRequest,
        callback: ResultCallback<RtcEnterpriseJoinHandle>,
    ) {
        issueRtcToken(
            RtcTokenRequest(
                externalUserId = request.externalUser.externalUserId,
                roomId = request.roomId,
                role = request.role,
                permissions = request.permissions,
                rtcMode = request.rtcMode,
            ),
            object : ResultCallback<RtcTokenIssue> {
                override fun onSuccess(result: RtcTokenIssue) {
                    startUsageSession(request, result, callback)
                }

                override fun onError(error: RtcEnterpriseException) {
                    activeJoinRequest = null
                    callback.onError(error)
                }
            },
        )
    }

    private fun startUsageSession(
        request: RtcEnterpriseJoinRequest,
        tokenIssue: RtcTokenIssue,
        callback: ResultCallback<RtcEnterpriseJoinHandle>,
    ) {
        if (request.joinAgoraMedia) {
            val preflightError = preflightAgoraMedia(request, tokenIssue)
            if (preflightError != null) {
                activeJoinRequest = null
                emitMediaPreflightFailure(preflightError)
                deliverError(callback, preflightError)
                return
            }
            emit(RtcEnterpriseEvent.MediaPreflightPassed(tokenIssue.signalingRoom, tokenIssue.localUid))
        }

        startSession(
            RtcSessionRequest(
                externalUserId = request.externalUser.externalUserId,
                roomId = request.roomId,
                role = request.role,
                rtcMode = request.rtcMode ?: tokenIssue.mediaType,
                microphoneEnabled = request.microphoneEnabled,
                cameraEnabled = request.cameraEnabled,
                screenShared = request.screenShared,
            ),
            object : ResultCallback<RtcSessionEnvelope> {
                override fun onSuccess(result: RtcSessionEnvelope) {
                    val mediaJoin = if (request.joinAgoraMedia) {
                        joinAgoraMedia(request, tokenIssue)
                    } else {
                        AgoraJoinResult(joined = false)
                    }
                    if (request.joinAgoraMedia && !mediaJoin.joined) {
                        cleanupFailedUsageSession(
                            request = request,
                            session = result,
                            originalError = mediaJoin.error ?: RtcEnterpriseException(
                                statusCode = 0,
                                code = "agora_media_join_failed",
                                message = "Agora media join failed before the RTC usage session became active.",
                            ),
                            callback = callback,
                        )
                        return
                    }
                    val handle = RtcEnterpriseJoinHandle(
                        externalUserId = request.externalUser.externalUserId,
                        roomId = request.roomId,
                        role = request.role,
                        mediaType = request.rtcMode ?: tokenIssue.mediaType,
                        tokenIssue = tokenIssue,
                        session = result,
                        channelName = tokenIssue.signalingRoom,
                        localUid = tokenIssue.localUid,
                        mediaJoined = mediaJoin.joined,
                    )
                    activeJoinHandle = handle
                    emit(RtcEnterpriseEvent.UsageSessionStarted(result.sessionId, result.participantId))
                    callback.onSuccess(handle)
                }

                override fun onError(error: RtcEnterpriseException) {
                    activeJoinRequest = null
                    callback.onError(error)
                }
            },
        )
    }

    private fun preflightAgoraMedia(
        request: RtcEnterpriseJoinRequest,
        tokenIssue: RtcTokenIssue,
    ): RtcEnterpriseException? {
        if (agoraAppId.isBlank()) {
            return RtcEnterpriseException(
                statusCode = 422,
                code = "missing_agora_app_id",
                message = "Agora App ID is required before joining RTC media.",
            )
        }

        val channelName = tokenIssue.signalingRoom
        if (channelName.isBlank()) {
            return RtcEnterpriseException(
                statusCode = 422,
                code = "missing_signaling_room",
                message = "The RTC token response did not include a signaling_room value.",
            )
        }

        if (resolveAgoraRtcToken(request, tokenIssue).isBlank()) {
            return RtcEnterpriseException(
                statusCode = 422,
                code = "missing_agora_rtc_token",
                message = "Native Agora media join requires agora_rtc_token, agora_token, or agoraRtcTokenOverride. The platform rtc_token must not be used as an Agora RTC media token.",
            )
        }

        val missingPermissions = missingMediaPermissions(request, tokenIssue)
        if (missingPermissions.isNotEmpty()) {
            return RtcEnterpriseException(
                statusCode = 0,
                code = "missing_android_permissions",
                message = "Missing Android media permissions: ${missingPermissions.joinToString(", ") { it.substringAfterLast(".") }}.",
            )
        }

        return null
    }

    private fun missingMediaPermissions(
        request: RtcEnterpriseJoinRequest,
        tokenIssue: RtcTokenIssue,
    ): List<String> {
        val mediaType = request.rtcMode ?: tokenIssue.mediaType
        val publishLocalMedia = request.role != RtcRoomRole.AUDIENCE
        val required = mutableListOf<String>()

        if (publishLocalMedia && request.microphoneEnabled) {
            required.add(Manifest.permission.RECORD_AUDIO)
        }
        if (publishLocalMedia && request.cameraEnabled && mediaType == "video") {
            required.add(Manifest.permission.CAMERA)
        }

        return required.filter { permission ->
            ContextCompat.checkSelfPermission(appContext, permission) != PackageManager.PERMISSION_GRANTED
        }
    }

    private fun resolveAgoraRtcToken(
        request: RtcEnterpriseJoinRequest,
        tokenIssue: RtcTokenIssue,
    ): String {
        val overrideToken = request.agoraRtcTokenOverride?.trim().orEmpty()
        if (overrideToken.isNotEmpty()) return overrideToken
        return tokenIssue.agoraRtcToken.trim()
    }

    private fun emitMediaPreflightFailure(error: RtcEnterpriseException) {
        emit(RtcEnterpriseEvent.MediaPreflightFailed(error.code, error.message))
        emit(RtcEnterpriseEvent.Error(error.code, error.message))
    }

    private fun cleanupFailedUsageSession(
        request: RtcEnterpriseJoinRequest,
        session: RtcSessionEnvelope,
        originalError: RtcEnterpriseException,
        callback: ResultCallback<RtcEnterpriseJoinHandle>,
    ) {
        agoraEngine?.leaveChannel()
        endSession(
            RtcSessionRequest(
                externalUserId = request.externalUser.externalUserId,
                roomId = request.roomId,
                sessionId = session.sessionId,
                role = request.role,
                rtcMode = request.rtcMode ?: session.room.optString("room_type"),
                microphoneEnabled = request.microphoneEnabled,
                cameraEnabled = request.cameraEnabled,
                screenShared = request.screenShared,
            ),
            object : ResultCallback<RtcSessionEndEnvelope> {
                override fun onSuccess(result: RtcSessionEndEnvelope) {
                    activeJoinRequest = null
                    activeJoinHandle = null
                    emit(RtcEnterpriseEvent.FailedSessionCleanedUp(result.sessionId))
                    deliverError(callback, originalError)
                }

                override fun onError(error: RtcEnterpriseException) {
                    activeJoinRequest = null
                    activeJoinHandle = null
                    emit(RtcEnterpriseEvent.FailedSessionCleanupError(session.sessionId, error.code, error.message))
                    deliverError(callback, originalError)
                }
            },
        )
    }

    private fun joinAgoraMedia(request: RtcEnterpriseJoinRequest, tokenIssue: RtcTokenIssue): AgoraJoinResult {
        val preflightError = preflightAgoraMedia(request, tokenIssue)
        if (preflightError != null) {
            emitMediaPreflightFailure(preflightError)
            return AgoraJoinResult(joined = false, error = preflightError)
        }

        val engine = ensureAgoraEngine()
        val channelName = tokenIssue.signalingRoom
        val mediaType = request.rtcMode ?: tokenIssue.mediaType
        val publishLocalMedia = request.role != RtcRoomRole.AUDIENCE

        if (mediaType == "video") {
            engine.enableVideo()
            if (publishLocalMedia) engine.startPreview()
        } else {
            engine.disableVideo()
        }
        engine.enableAudio()

        val options = ChannelMediaOptions()
        options.channelProfile = if (tokenIssue.channelProfile == "live_broadcasting") {
            Constants.CHANNEL_PROFILE_LIVE_BROADCASTING
        } else {
            Constants.CHANNEL_PROFILE_COMMUNICATION
        }
        options.clientRoleType = if (request.role == RtcRoomRole.AUDIENCE) {
            Constants.CLIENT_ROLE_AUDIENCE
        } else {
            Constants.CLIENT_ROLE_BROADCASTER
        }
        options.publishMicrophoneTrack = publishLocalMedia && request.microphoneEnabled
        options.publishCameraTrack = publishLocalMedia && request.cameraEnabled && mediaType == "video"
        options.autoSubscribeAudio = true
        options.autoSubscribeVideo = mediaType == "video"

        val tokenForAgora = resolveAgoraRtcToken(request, tokenIssue)
        val result = engine.joinChannel(tokenForAgora, channelName, tokenIssue.localUid, options)
        if (result != 0) {
            val error = RtcEnterpriseException(
                statusCode = 0,
                code = "agora_join_failed",
                message = "Agora joinChannel failed with code $result.",
            )
            emit(RtcEnterpriseEvent.Error(error.code, error.message))
            return AgoraJoinResult(joined = false, error = error)
        }

        emit(RtcEnterpriseEvent.JoiningMedia(channelName, tokenIssue.localUid))
        return AgoraJoinResult(joined = true)
    }

    private fun ensureAgoraEngine(): RtcEngine {
        val existing = agoraEngine
        if (existing != null) return existing

        val config = RtcEngineConfig()
        config.mContext = appContext
        config.mAppId = agoraAppId
        config.mEventHandler = agoraEventHandler

        val created = RtcEngine.create(config)
        agoraEngine = created
        return created
    }

    private fun setupRemoteVideo(remoteUid: Int) {
        val remoteSurfaceView = SurfaceView(viewContext)
        remoteSurfaceView.setZOrderMediaOverlay(true)
        remoteSurfaceView.visibility = View.VISIBLE
        agoraEngine?.setupRemoteVideo(
            VideoCanvas(remoteSurfaceView, VideoCanvas.RENDER_MODE_FIT, remoteUid),
        )
        listener?.onRemoteUserJoined(remoteUid, remoteSurfaceView)
    }

    private val agoraEventHandler: IRtcEngineEventHandler = object : IRtcEngineEventHandler() {
        override fun onJoinChannelSuccess(channel: String, uid: Int, elapsed: Int) {
            emit(RtcEnterpriseEvent.JoinedMedia(channel, uid, elapsed))
        }

        override fun onUserJoined(uid: Int, elapsed: Int) {
            emit(RtcEnterpriseEvent.RemoteUserJoined(uid, elapsed))
            setupRemoteVideo(uid)
        }

        override fun onUserOffline(uid: Int, reason: Int) {
            emit(RtcEnterpriseEvent.RemoteUserLeft(uid, reason))
            listener?.onRemoteUserLeft(uid)
        }

        override fun onConnectionStateChanged(state: Int, reason: Int) {
            emit(RtcEnterpriseEvent.ConnectionStateChanged(state, reason))
        }

        override fun onTokenPrivilegeWillExpire(token: String) {
            emit(RtcEnterpriseEvent.TokenWillExpire)
            renewAgoraToken()
        }

        override fun onRequestToken() {
            emit(RtcEnterpriseEvent.TokenExpired)
            renewAgoraToken()
        }

        override fun onError(err: Int) {
            val message = when (err) {
                ErrorCode.ERR_TOKEN_EXPIRED -> "Agora token expired."
                ErrorCode.ERR_INVALID_TOKEN -> "Agora token is invalid."
                else -> "Agora error code: $err"
            }
            val error = RtcEnterpriseException(0, "agora_error_$err", message)
            listener?.onError(error)
            emit(RtcEnterpriseEvent.Error(error.code, error.message))
        }
    }

    private fun renewAgoraToken() {
        val request = activeJoinRequest ?: return
        issueRtcToken(
            RtcTokenRequest(
                externalUserId = request.externalUser.externalUserId,
                roomId = request.roomId,
                role = request.role,
                permissions = request.permissions,
                rtcMode = request.rtcMode,
            ),
            object : ResultCallback<RtcTokenIssue> {
                override fun onSuccess(result: RtcTokenIssue) {
                    val agoraToken = resolveAgoraRtcToken(request, result)
                    if (agoraToken.isBlank()) {
                        val error = RtcEnterpriseException(
                            statusCode = 422,
                            code = "missing_agora_rtc_token",
                            message = "Agora token renewal requires agora_rtc_token, agora_token, or agoraRtcTokenOverride.",
                        )
                        emit(RtcEnterpriseEvent.TokenRenewalFailed(error.code, error.message))
                        emit(RtcEnterpriseEvent.Error(error.code, error.message))
                        listener?.onError(error)
                        return
                    }
                    val renewCode = agoraEngine?.renewToken(agoraToken)
                    if (renewCode != null && renewCode != 0) {
                        val error = RtcEnterpriseException(
                            statusCode = 0,
                            code = "agora_token_renew_failed",
                            message = "Agora renewToken failed with code $renewCode.",
                        )
                        emit(RtcEnterpriseEvent.TokenRenewalFailed(error.code, error.message))
                        emit(RtcEnterpriseEvent.Error(error.code, error.message))
                        listener?.onError(error)
                        return
                    }
                    val currentHandle = activeJoinHandle
                    if (currentHandle != null) {
                        activeJoinHandle = currentHandle.copy(tokenIssue = result)
                    }
                    emit(RtcEnterpriseEvent.TokenRenewed(result.expiresAt))
                }

                override fun onError(error: RtcEnterpriseException) {
                    emit(RtcEnterpriseEvent.TokenRenewalFailed(error.code, error.message))
                    emit(RtcEnterpriseEvent.Error(error.code, error.message))
                    listener?.onError(error)
                }
            },
        )
    }

    private fun <T> requestJson(
        method: String,
        path: String,
        body: JSONObject?,
        query: Map<String, Any?>,
        callback: ResultCallback<T>,
        parser: (JSONObject) -> T,
    ) {
        if (!validateSdkConfiguration(callback)) return

        val requestBuilder = Request.Builder()
            .url(buildUrl(path, query))
            .header("Accept", "application/json")
            .header("x-rtc-api-key", apiKey)

        val requestBody = body?.toString()?.toRequestBody(JSON_MEDIA_TYPE)
        when (method.uppercase()) {
            "GET" -> requestBuilder.get()
            "POST" -> requestBuilder.post(requestBody ?: emptyJsonBody())
            "PATCH" -> requestBuilder.patch(requestBody ?: emptyJsonBody())
            "DELETE" -> if (requestBody == null) requestBuilder.delete() else requestBuilder.delete(requestBody)
            else -> requestBuilder.method(method.uppercase(), requestBody)
        }

        httpClient.newCall(requestBuilder.build()).enqueue(object : Callback {
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    val responseText = it.body?.string().orEmpty()
                    if (it.isSuccessful) {
                        try {
                            val json = if (responseText.isBlank()) JSONObject() else JSONObject(responseText)
                            deliverSuccess(callback, parser(json))
                        } catch (error: JSONException) {
                            deliverError(
                                callback,
                                RtcEnterpriseException(
                                    statusCode = it.code,
                                    code = "invalid_json",
                                    message = "Client API returned invalid JSON.",
                                ),
                            )
                        }
                        return
                    }

                    deliverError(callback, apiExceptionFromResponse(it.code, it.message, responseText))
                }
            }

            override fun onFailure(call: Call, e: IOException) {
                deliverError(
                    callback,
                    RtcEnterpriseException(
                        statusCode = 0,
                        code = "network_error",
                        message = e.message ?: "Client API request failed.",
                    ),
                )
            }
        })
    }

    private fun buildUrl(path: String, query: Map<String, Any?>): String {
        val builder = Uri.parse("$baseUrl$path").buildUpon()
        query.entries
            .filter { (_, value) -> value != null && value.toString().trim().isNotEmpty() }
            .forEach { (key, value) -> builder.appendQueryParameter(key, value.toString()) }
        return builder.build().toString()
    }

    private fun apiExceptionFromResponse(
        statusCode: Int,
        responseMessage: String,
        responseText: String,
    ): RtcEnterpriseException {
        val raw = try {
            if (responseText.isBlank()) null else JSONObject(responseText)
        } catch (_: JSONException) {
            null
        }
        return RtcEnterpriseException(
            statusCode = statusCode,
            code = raw?.optString("code")?.takeIf { it.isNotBlank() } ?: "client_api_error",
            message = raw?.optString("message")?.takeIf { it.isNotBlank() }
                ?: responseMessage.takeIf { it.isNotBlank() }
                ?: "Client API request failed.",
            errors = raw?.optJSONObject("errors"),
            raw = raw,
        )
    }

    private fun <T> validateSdkConfiguration(callback: ResultCallback<T>): Boolean {
        val errors = mutableMapOf<String, String>()
        if (baseUrl.isBlank() || !(baseUrl.startsWith("http://") || baseUrl.startsWith("https://"))) {
            errors["api_base_url"] = "apiBaseUrl must start with http:// or https://."
        }
        if (apiKey.isBlank()) {
            errors["client_api_key"] = "clientApiKey is required for direct client API mode."
        }
        return validateRequest(errors, callback)
    }

    private fun <T> validateRequest(errors: Map<String, String>, callback: ResultCallback<T>): Boolean {
        if (errors.isEmpty()) return true
        deliverError(
            callback,
            RtcEnterpriseException(
                statusCode = 422,
                code = "validation_error",
                message = "Check RTC SDK request details.",
                errors = mapToJson(errors),
            ),
        )
        return false
    }

    private fun <T> deliverSuccess(callback: ResultCallback<T>, result: T) {
        mainHandler.post { callback.onSuccess(result) }
    }

    private fun <T> deliverError(callback: ResultCallback<T>, error: RtcEnterpriseException) {
        mainHandler.post {
            callback.onError(error)
            listener?.onError(error)
        }
    }

    private fun <T> deliverErrorIfPresent(callback: ResultCallback<T>?, error: RtcEnterpriseException) {
        if (callback == null) return
        mainHandler.post { callback.onError(error) }
    }

    private fun emit(event: RtcEnterpriseEvent) {
        mainHandler.post { listener?.onEvent(event) }
    }

    private fun emptyJsonBody(): RequestBody = "{}".toRequestBody(JSON_MEDIA_TYPE)

    private fun urlEncode(value: String): String {
        return URLEncoder.encode(value, "UTF-8").replace("+", "%20")
    }

    companion object {
        val REQUIRED_PERMISSIONS = arrayOf(
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.CAMERA,
        )

        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}

data class RtcExternalUserSyncRequest(
    val externalUserId: String,
    val name: String,
    val email: String? = null,
    val phone: String? = null,
    val avatarUrl: String? = null,
    val status: String = "active",
    val metadata: Map<String, Any?>? = null,
) {
    fun validationErrors(): Map<String, String> {
        val errors = validateExternalUserId(externalUserId).toMutableMap()
        if (name.trim().isBlank()) errors["name"] = "User name is required."
        if (email != null && email.trim().isNotEmpty() && !isValidEmail(email)) {
            errors["email"] = "Enter a valid email or omit email."
        }
        if (!VALID_EXTERNAL_USER_STATUSES.contains(status.trim().lowercase())) {
            errors["status"] = "Choose active, inactive, or banned."
        }
        return errors
    }

    fun toJson(): JSONObject = jsonObject(
        "external_user_id" to externalUserId,
        "name" to name,
        "email" to email,
        "phone" to phone,
        "avatar_url" to avatarUrl,
        "status" to status,
        "metadata" to metadata,
    )
}

data class RtcRoomListQuery(
    val status: String = "active",
    val privacyType: String = "all",
    val roomType: String = "all",
    val search: String = "",
    val page: Int = 1,
    val perPage: Int = 24,
) {
    fun validationErrors(): Map<String, String> {
        val errors = mutableMapOf<String, String>()
        if (!VALID_ROOM_LIST_STATUSES.contains(status.trim().lowercase())) {
            errors["status"] = "Choose active, inactive, ended, or all."
        }
        if (!VALID_ROOM_LIST_FILTERS.contains(privacyType.trim().lowercase())) {
            errors["privacy_type"] = "Choose public, private, password, or all."
        }
        val normalizedRoomType = roomType.trim().lowercase()
        if (normalizedRoomType != "all" && !VALID_ROOM_TYPES.contains(normalizedRoomType)) {
            errors["room_type"] = "Choose a supported room type or all."
        }
        if (page < 1) errors["page"] = "page must be greater than 0."
        if (perPage < 1 || perPage > 60) errors["per_page"] = "perPage must be between 1 and 60."
        return errors
    }

    fun toQuery(): Map<String, Any?> = mapOf(
        "status" to status,
        "privacy_type" to privacyType,
        "room_type" to roomType,
        "q" to search,
        "page" to page,
        "per_page" to perPage,
    )
}

data class RtcRoomCreateRequest(
    val externalUserId: String,
    val name: String,
    val description: String? = null,
    val profileImage: String? = null,
    val roomType: String = "video",
    val privacyType: String = "public",
    val password: String? = null,
    val maxMicCount: Int = 8,
    val theme: String? = null,
    val chatEnabled: Boolean = true,
    val giftEnabled: Boolean = false,
    val screenShareEnabled: Boolean = false,
    val aiSecurityEnabled: Boolean = false,
) {
    fun validationErrors(): Map<String, String> {
        val errors = validateExternalUserId(externalUserId).toMutableMap()
        val normalizedRoomType = roomType.trim().lowercase()
        val normalizedPrivacyType = privacyType.trim().lowercase()

        if (name.trim().length < 3) errors["name"] = "Room name must be at least 3 characters."
        if (!VALID_ROOM_TYPES.contains(normalizedRoomType)) {
            errors["room_type"] = "Choose a supported room type."
        }
        if (!VALID_PRIVACY_TYPES.contains(normalizedPrivacyType)) {
            errors["privacy_type"] = "Choose public, private, or password."
        }

        val maxSeats = if (ONE_TO_ONE_ROOM_TYPES.contains(normalizedRoomType)) 2 else 20
        if (maxMicCount < 1 || maxMicCount > maxSeats) {
            errors["max_mic_count"] = "maxMicCount must be between 1 and $maxSeats."
        }
        if (normalizedPrivacyType == "password" && (password ?: "").trim().length < 4) {
            errors["password"] = "Password rooms need a password of at least 4 characters."
        }
        return errors
    }

    fun toJson(): JSONObject = jsonObject(
        "external_user_id" to externalUserId,
        "name" to name,
        "description" to description,
        "profile_image" to profileImage,
        "room_type" to roomType,
        "privacy_type" to privacyType,
        "password" to password,
        "max_mic_count" to maxMicCount,
        "theme" to theme,
        "chat_enabled" to chatEnabled,
        "gift_enabled" to giftEnabled,
        "screen_share_enabled" to screenShareEnabled,
        "ai_security_enabled" to aiSecurityEnabled,
    )
}

enum class RtcRoomRole(val apiValue: String) {
    AUDIENCE("audience"),
    PUBLISHER("publisher"),
    MODERATOR("moderator"),
    ROOM_ADMIN("admin"),
    OWNER("owner"),
}

data class RtcTokenRequest(
    val externalUserId: String,
    val roomId: Int,
    val role: RtcRoomRole = RtcRoomRole.PUBLISHER,
    val permissions: List<String> = emptyList(),
    val rtcMode: String? = null,
) {
    fun validationErrors(): Map<String, String> {
        val errors = validateExternalUserId(externalUserId).toMutableMap()
        errors.putAll(validateRoomId(roomId))
        rtcMode?.trim()?.lowercase()?.let { mode ->
            if (mode.isNotEmpty() && !VALID_RTC_MODES.contains(mode)) {
                errors["rtc_mode"] = "Choose a supported RTC mode."
            }
        }
        return errors
    }

    fun toJson(): JSONObject = jsonObject(
        "external_user_id" to externalUserId,
        "room_id" to roomId,
        "role" to role.apiValue,
        "permissions" to JSONArray(permissions),
        "rtc_mode" to rtcMode,
    )
}

data class RtcSessionRequest(
    val externalUserId: String,
    val roomId: Int,
    val sessionId: Int? = null,
    val role: RtcRoomRole = RtcRoomRole.PUBLISHER,
    val rtcMode: String? = null,
    val microphoneEnabled: Boolean = true,
    val cameraEnabled: Boolean = true,
    val screenShared: Boolean = false,
) {
    fun validationErrors(): Map<String, String> {
        val errors = validateExternalUserId(externalUserId).toMutableMap()
        errors.putAll(validateRoomId(roomId))
        if (sessionId != null && sessionId < 1) {
            errors["session_id"] = "sessionId must be greater than 0."
        }
        rtcMode?.trim()?.lowercase()?.let { mode ->
            if (mode.isNotEmpty() && !VALID_RTC_MODES.contains(mode)) {
                errors["rtc_mode"] = "Choose a supported RTC mode."
            }
        }
        return errors
    }

    fun toJson(): JSONObject = jsonObject(
        "external_user_id" to externalUserId,
        "room_id" to roomId,
        "session_id" to sessionId,
        "role" to role.apiValue,
        "rtc_mode" to rtcMode,
        "mic_enabled" to microphoneEnabled,
        "camera_enabled" to cameraEnabled,
        "screen_shared" to screenShared,
    )
}

data class RtcEnterpriseJoinRequest(
    val externalUser: RtcExternalUserSyncRequest,
    val roomId: Int,
    val role: RtcRoomRole = RtcRoomRole.PUBLISHER,
    val rtcMode: String? = null,
    val permissions: List<String> = emptyList(),
    val microphoneEnabled: Boolean = true,
    val cameraEnabled: Boolean = true,
    val screenShared: Boolean = false,
    val syncExternalUserBeforeJoin: Boolean = true,
    val joinAgoraMedia: Boolean = true,
    val agoraRtcTokenOverride: String? = null,
) {
    fun validationErrors(): Map<String, String> {
        val errors = externalUser.validationErrors().toMutableMap()
        errors.putAll(validateRoomId(roomId))
        rtcMode?.trim()?.lowercase()?.let { mode ->
            if (mode.isNotEmpty() && !VALID_RTC_MODES.contains(mode)) {
                errors["rtc_mode"] = "Choose a supported RTC mode."
            }
        }
        return errors
    }
}

data class RtcEnterpriseJoinHandle(
    val externalUserId: String,
    val roomId: Int,
    val role: RtcRoomRole,
    val mediaType: String,
    val tokenIssue: RtcTokenIssue,
    val session: RtcSessionEnvelope,
    val channelName: String,
    val localUid: Int,
    val mediaJoined: Boolean,
)

class RtcClientMeEnvelope(val raw: JSONObject) {
    val tenant: JSONObject get() = raw.optJSONObject("tenant") ?: JSONObject()
    val app: JSONObject get() = raw.optJSONObject("app") ?: JSONObject()
    val billing: RtcBillingPolicy get() = RtcBillingPolicy(raw.optJSONObject("billing") ?: JSONObject())
    val tenantModel: RtcTenant get() = RtcTenant(tenant)
    val appModel: RtcClientApp get() = RtcClientApp(app)
    val auth: String get() = raw.optString("auth")
}

class RtcExternalUserEnvelope(val raw: JSONObject) {
    val externalUser: JSONObject get() = raw.optJSONObject("external_user") ?: JSONObject()
    val user: RtcExternalUser get() = RtcExternalUser(externalUser)
    val externalUserId: String get() = externalUser.optString("external_user_id")
    val userId: Int get() = externalUser.optInt("user_id")
}

class RtcRoomListEnvelope(val raw: JSONObject) {
    val rooms: JSONArray get() = raw.optJSONArray("rooms") ?: JSONArray()
    val roomItems: List<RtcRoom> get() = rooms.toJsonObjectList().map { RtcRoom(it) }
    val pagination: JSONObject get() = raw.optJSONObject("pagination") ?: JSONObject()
    val pageInfo: RtcPagination get() = RtcPagination(pagination)
}

class RtcRoomEnvelope(val raw: JSONObject) {
    val room: JSONObject get() = raw.optJSONObject("room") ?: JSONObject()
    val roomModel: RtcRoom get() = RtcRoom(room)
    val roomId: Int get() = room.optInt("id")
    val signalingRoom: String get() = room.optString("signaling_room")
}

class RtcRoomEndEnvelope(val raw: JSONObject) {
    val roomId: Int get() = raw.optInt("room_id")
}

class RtcTokenIssue(val raw: JSONObject) {
    val rtcToken: String get() = raw.optString("rtc_token")
    val tokenType: String get() = raw.optString("token_type", "Bearer")
    val expiresIn: Int get() = raw.optInt("expires_in")
    val expiresAt: String get() = raw.optString("expires_at")
    val room: JSONObject get() = raw.optJSONObject("room") ?: JSONObject()
    val externalUser: JSONObject get() = raw.optJSONObject("external_user") ?: JSONObject()
    val grants: JSONObject get() = raw.optJSONObject("grants") ?: JSONObject()
    val roomModel: RtcRoom get() = RtcRoom(room)
    val user: RtcExternalUser get() = RtcExternalUser(externalUser)
    val grantModel: RtcTokenGrants get() = RtcTokenGrants(grants)
    val signalingRoom: String get() = room.optString("signaling_room")
    val localUid: Int get() = externalUser.optInt("user_id", 0)
    val channelProfile: String
        get() = (room.optJSONObject("rtc_profile") ?: JSONObject()).optString(
            "channel_profile",
            "communication",
        )
    val mediaType: String
        get() = (room.optJSONObject("rtc_profile") ?: JSONObject()).optString(
            "media_type",
            "video",
        )

    val agoraRtcToken: String
        get() {
            val explicitToken = raw.optString("agora_rtc_token").trim()
            if (explicitToken.isNotEmpty()) return explicitToken
            return raw.optString("agora_token").trim()
        }

    val hasAgoraRtcToken: Boolean get() = agoraRtcToken.isNotBlank()
}

open class RtcSessionEnvelope(val raw: JSONObject) {
    val session: JSONObject get() = raw.optJSONObject("session") ?: JSONObject()
    val participant: JSONObject get() = raw.optJSONObject("participant") ?: JSONObject()
    val room: JSONObject get() = raw.optJSONObject("room") ?: JSONObject()
    val externalUser: JSONObject get() = raw.optJSONObject("external_user") ?: JSONObject()
    val sessionModel: RtcSession get() = RtcSession(session)
    val participantModel: RtcParticipant get() = RtcParticipant(participant)
    val roomModel: RtcRoom get() = RtcRoom(room)
    val user: RtcExternalUser get() = RtcExternalUser(externalUser)
    open val sessionId: Int get() = raw.optInt("session_id", session.optInt("id"))
    val participantId: Int get() = raw.optInt("participant_id", participant.optInt("id"))
}

data class RtcTenant(val raw: JSONObject) {
    val id: Int get() = raw.optInt("id", raw.optInt("tenant_id"))
    val name: String get() = raw.optString("name", raw.optString("tenant_name"))
}

data class RtcClientApp(val raw: JSONObject) {
    val id: Int get() = raw.optInt("id", raw.optInt("app_id"))
    val appKey: String get() = raw.optString("app_key")
    val name: String get() = raw.optString("name", raw.optString("app_name"))
}

data class RtcBillingPolicy(val raw: JSONObject) {
    val payer: String get() = raw.optString("payer", "client_company")
    val billingScope: String get() = raw.optString("billing_scope", "client_company")
    val tenantId: Int get() = raw.optInt("tenant_id")
    val tenantName: String get() = raw.optString("tenant_name")
    val userPays: Boolean get() = raw.optBoolean("user_pays", false)
    val note: String get() = raw.optString("note")
}

data class RtcExternalUser(val raw: JSONObject) {
    val id: Int get() = raw.optInt("id")
    val userId: Int get() = raw.optInt("user_id")
    val externalUserId: String get() = raw.optString("external_user_id")
    val name: String get() = raw.optString("name")
    val email: String get() = raw.optString("email")
    val avatarUrl: String get() = raw.optString("avatar_url")
    val status: String get() = raw.optString("status")
    val billingScope: String get() = raw.optString("billing_scope", "client_company")
    val userPays: Boolean get() = raw.optBoolean("user_pays", false)
}

data class RtcRoom(val raw: JSONObject) {
    val id: Int get() = raw.optInt("id")
    val tenantId: Int get() = raw.optInt("tenant_id")
    val name: String get() = raw.optString("name")
    val description: String get() = raw.optString("description")
    val roomType: String get() = raw.optString("room_type")
    val privacyType: String get() = raw.optString("privacy_type")
    val status: String get() = raw.optString("status")
    val maxMicCount: Int get() = raw.optInt("max_mic_count")
    val activeParticipants: Int get() = raw.optInt("active_participants")
    val signalingRoom: String get() = raw.optString("signaling_room")
    val rtcProfile: RtcProfile get() = RtcProfile(raw.optJSONObject("rtc_profile") ?: JSONObject())
    val controls: RtcRoomControls get() = RtcRoomControls(raw.optJSONObject("controls") ?: JSONObject())
    val billing: RtcBillingPolicy get() = RtcBillingPolicy(raw.optJSONObject("billing") ?: JSONObject())
}

data class RtcProfile(val raw: JSONObject) {
    val channelProfile: String get() = raw.optString("channel_profile", "communication")
    val agoraWebMode: String get() = raw.optString("agora_web_mode", "rtc")
    val clientRole: String get() = raw.optString("client_role", "broadcaster")
    val mediaType: String get() = raw.optString("media_type", "video")
}

data class RtcRoomControls(val raw: JSONObject) {
    val chatEnabled: Boolean get() = raw.optBoolean("chat_enabled")
    val giftEnabled: Boolean get() = raw.optBoolean("gift_enabled")
    val screenShareEnabled: Boolean get() = raw.optBoolean("screen_share_enabled")
    val aiSecurityEnabled: Boolean get() = raw.optBoolean("ai_security_enabled")
}

data class RtcTokenGrants(val raw: JSONObject) {
    val role: String get() = raw.optString("role")
    val roomId: Int get() = raw.optInt("room_id")
    val permissions: List<String> get() = raw.optJSONArray("permissions").toStringList()
}

data class RtcSession(val raw: JSONObject) {
    val id: Int get() = raw.optInt("id", raw.optInt("session_id"))
    val roomId: Int get() = raw.optInt("room_id")
    val signalingRoom: String get() = raw.optString("signaling_room")
    val status: String get() = raw.optString("status")
    val sessionType: String get() = raw.optString("session_type")
}

data class RtcParticipant(val raw: JSONObject) {
    val id: Int get() = raw.optInt("id", raw.optInt("participant_id"))
    val sessionId: Int get() = raw.optInt("session_id")
    val roomId: Int get() = raw.optInt("room_id")
    val userId: Int get() = raw.optInt("user_id")
    val peerUid: Int get() = raw.optInt("peer_uid")
    val roleInRoom: String get() = raw.optString("role_in_room")
    val connectionStatus: String get() = raw.optString("connection_status")
    val microphoneEnabled: Boolean get() = raw.optBoolean("mic_enabled")
    val cameraEnabled: Boolean get() = raw.optBoolean("camera_enabled")
    val screenShared: Boolean get() = raw.optBoolean("screen_shared")
}

data class RtcPagination(val raw: JSONObject) {
    val page: Int get() = raw.optInt("page", 1)
    val perPage: Int get() = raw.optInt("per_page")
    val total: Int get() = raw.optInt("total")
    val totalPages: Int get() = raw.optInt("total_pages", 1)
}

class RtcSessionEndEnvelope(raw: JSONObject) : RtcSessionEnvelope(raw) {
    override val sessionId: Int get() = raw.optInt("session_id")
    val durationSeconds: Int get() = raw.optInt("duration_seconds")
    val billableMinutes: Double get() = raw.optDouble("billable_minutes")
    val roomMinutes: Double get() = raw.optDouble("room_minutes")
}

sealed class RtcEnterpriseEvent {
    data class MediaPreflightPassed(val channelName: String, val localUid: Int) : RtcEnterpriseEvent()
    data class MediaPreflightFailed(val code: String, val message: String) : RtcEnterpriseEvent()
    data class JoiningMedia(val channelName: String, val localUid: Int) : RtcEnterpriseEvent()
    data class JoinedMedia(val channelName: String, val localUid: Int, val elapsed: Int) : RtcEnterpriseEvent()
    data class RemoteUserJoined(val remoteUid: Int, val elapsed: Int) : RtcEnterpriseEvent()
    data class RemoteUserLeft(val remoteUid: Int, val reason: Int) : RtcEnterpriseEvent()
    data class UsageSessionStarted(val sessionId: Int, val participantId: Int) : RtcEnterpriseEvent()
    data class UsageSessionEnded(val sessionId: Int, val durationSeconds: Int) : RtcEnterpriseEvent()
    data class FailedSessionCleanedUp(val sessionId: Int) : RtcEnterpriseEvent()
    data class FailedSessionCleanupError(val sessionId: Int, val code: String, val message: String) : RtcEnterpriseEvent()
    data class LocalMediaChanged(val microphoneEnabled: Boolean, val cameraEnabled: Boolean) : RtcEnterpriseEvent()
    data class ConnectionStateChanged(val state: Int, val reason: Int) : RtcEnterpriseEvent()
    data class TokenRenewed(val expiresAt: String) : RtcEnterpriseEvent()
    data class TokenRenewalFailed(val code: String, val message: String) : RtcEnterpriseEvent()
    data class Error(val code: String, val message: String) : RtcEnterpriseEvent()
    object TokenWillExpire : RtcEnterpriseEvent()
    object TokenExpired : RtcEnterpriseEvent()
    object LeftMedia : RtcEnterpriseEvent()
    object CameraSwitched : RtcEnterpriseEvent()
    object Released : RtcEnterpriseEvent()
}

class RtcEnterpriseException(
    val statusCode: Int,
    val code: String,
    override val message: String,
    val errors: JSONObject? = null,
    val raw: JSONObject? = null,
) : Exception(message)

val RtcEnterpriseException.errorMap: Map<String, String>
    get() = errors.toStringMap()

private fun jsonObject(vararg entries: Pair<String, Any?>): JSONObject {
    val json = JSONObject()
    entries.forEach { (key, value) -> putJsonValue(json, key, value) }
    return json
}

private fun putJsonValue(json: JSONObject, key: String, value: Any?) {
    if (value == null) return
    when (value) {
        is JSONObject -> json.put(key, value)
        is JSONArray -> json.put(key, value)
        is Map<*, *> -> json.put(key, mapToJson(value))
        is Iterable<*> -> json.put(key, iterableToJson(value))
        else -> json.put(key, value)
    }
}

private fun mapToJson(map: Map<*, *>): JSONObject {
    val json = JSONObject()
    map.entries.forEach { (key, value) ->
        if (key != null) putJsonValue(json, key.toString(), value)
    }
    return json
}

private fun iterableToJson(values: Iterable<*>): JSONArray {
    val array = JSONArray()
    values.forEach { value ->
        when (value) {
            null -> array.put(JSONObject.NULL)
            is JSONObject -> array.put(value)
            is JSONArray -> array.put(value)
            is Map<*, *> -> array.put(mapToJson(value))
            is Iterable<*> -> array.put(iterableToJson(value))
            else -> array.put(value)
        }
    }
    return array
}

private fun JSONArray?.toJsonObjectList(): List<JSONObject> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { index -> optJSONObject(index) }
}

private fun JSONArray?.toStringList(): List<String> {
    if (this == null) return emptyList()
    return (0 until length())
        .map { index -> optString(index) }
        .filter { value -> value.isNotBlank() }
}

private fun JSONObject?.toStringMap(): Map<String, String> {
    if (this == null) return emptyMap()
    val output = mutableMapOf<String, String>()
    keys().forEach { key ->
        output[key] = optString(key)
    }
    return output
}

private fun validateExternalUserId(externalUserId: String): Map<String, String> {
    val trimmed = externalUserId.trim()
    val errors = mutableMapOf<String, String>()
    if (trimmed.isBlank()) errors["external_user_id"] = "externalUserId is required."
    if (trimmed.length > 190) errors["external_user_id"] = "externalUserId must be 190 characters or fewer."
    return errors
}

private fun validateRoomId(roomId: Int): Map<String, String> {
    return if (roomId > 0) {
        emptyMap()
    } else {
        mapOf("room_id" to "roomId must be greater than 0.")
    }
}

private fun isValidEmail(value: String): Boolean {
    return EMAIL_PATTERN.matches(value.trim())
}

private val EMAIL_PATTERN = Regex("^[^\\s@]+@(?:[A-Za-z0-9-]+\\.)+[A-Za-z]{2,63}$")
private val VALID_EXTERNAL_USER_STATUSES = setOf("active", "inactive", "banned")
private val VALID_ROOM_STATUSES = setOf("active", "inactive", "ended")
private val VALID_ROOM_LIST_STATUSES = VALID_ROOM_STATUSES + "all"
private val VALID_PRIVACY_TYPES = setOf("public", "private", "password")
private val VALID_ROOM_LIST_FILTERS = VALID_PRIVACY_TYPES + "all"
private val VALID_ROOM_TYPES = setOf(
    "audio",
    "youtube_audio",
    "one_to_one_audio",
    "video",
    "one_to_one_video",
    "group_audio",
    "group_video",
    "solo_live",
    "pk_live",
)
private val ONE_TO_ONE_ROOM_TYPES = setOf("one_to_one_audio", "one_to_one_video")
private val VALID_RTC_MODES = VALID_ROOM_TYPES + setOf("audio", "video")
